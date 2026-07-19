/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Request, Response } from "@paperback/types";
import { CloudflareError, PaperbackInterceptor, URL } from "@paperback/types";

import {
  API_URL,
  BASE_URL,
  DATA_SAVER_KEY,
  DEFAULT_CACHE_URL,
  INTEGRITY_EXP_KEY,
  INTEGRITY_TOKEN_KEY,
  METADATA_CACHE_DATE_KEY,
  METADATA_CACHE_KEY,
  METADATA_CACHE_TTL_SECONDS,
  type ChallengeDto,
  type GenreDto,
  type IntegrityDto,
  type KaganeMetadata,
  type SourcesDto,
} from "../implementations/shared/models";

export class KaganeInterceptor extends PaperbackInterceptor {
  async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        origin: BASE_URL,
        referer: `${BASE_URL}/`,
        "user-agent": await Application.getDefaultUserAgent(),
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (await isCloudflareChallenge(request, response, data)) {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: {
          ...request.headers,
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }

    if (!shouldRetryPageRequest(request, response, data)) {
      return data;
    }

    const retryRequest = await buildPageRetryRequest(request);
    if (!retryRequest) {
      return data;
    }

    const [, retryData] = await Application.scheduleRequest(retryRequest);
    return retryData;
  }
}

async function isCloudflareChallenge(
  request: Request,
  response: Response,
  data: ArrayBuffer,
): Promise<boolean> {
  if (!request.url.startsWith(BASE_URL)) {
    return false;
  }
  // Only the site's navigational GET requests (the reader warm-up and the
  // detail/metadata loads that precede opening a chapter) can be solved by the
  // bypass WebView. The browse/search XHR POSTs ride on the clearance those
  // obtain, so raising a challenge on a POST would only spin an unsolvable
  // loop — keep the bypass tied to the reader/navigation flow.
  if ((request.method ?? "GET").toUpperCase() !== "GET") {
    return false;
  }
  if (response.headers?.["cf-mitigated"] === "challenge") {
    return true;
  }
  if (response.status !== 403) {
    return false;
  }

  const headerKeys = Object.keys(response.headers ?? {}).map((key) => key.toLowerCase());
  if (headerKeys.some((key) => key.startsWith("cf-") || key === "server")) {
    const serverHeaderKey = Object.keys(response.headers ?? {}).find(
      (key) => key.toLowerCase() === "server",
    );
    const server = serverHeaderKey ? response.headers[serverHeaderKey] : "";
    if (!server || server.toLowerCase().includes("cloudflare")) {
      return true;
    }
  }

  const text = Application.arrayBufferToUTF8String(data);
  return (
    typeof text === "string" &&
    /cloudflare|cf-browser-verification|cf-challenge|Just a moment/i.test(text)
  );
}

function shouldRetryPageRequest(request: Request, response: Response, data: ArrayBuffer): boolean {
  if (request.headers?.["x-kagane-retry"] === "1") {
    return false;
  }
  if (!getPageRequestParts(request.url)) {
    return false;
  }
  if (response.status === 401 || response.status === 403 || response.status === 507) {
    return true;
  }

  const text = Application.arrayBufferToUTF8String(data);
  if (typeof text !== "string") {
    return false;
  }

  return /integrity|token|unauthorized|forbidden/i.test(text);
}

async function buildPageRetryRequest(request: Request): Promise<Request | undefined> {
  const parts = getPageRequestParts(request.url);
  if (!parts) return undefined;

  const challenge = await getChallengeResponse(parts.chapterId, true);
  const cacheUrl = challenge.cache_url || DEFAULT_CACHE_URL;
  const retryUrl = new URL(cacheUrl)
    .addPathComponent("api")
    .addPathComponent("v2")
    .addPathComponent("books")
    .addPathComponent("page")
    .addPathComponent(parts.chapterId)
    .addPathComponent(parts.fileName)
    .setQueryItem("token", challenge.access_token)
    .setQueryItem("is_datasaver", String(getDataSaver()))
    .toString();

  return {
    ...request,
    url: retryUrl,
    method: "GET",
    headers: {
      ...request.headers,
      "x-kagane-retry": "1",
    },
  };
}

function getPageRequestParts(url: string): { chapterId: string; fileName: string } | undefined {
  const match = url.match(/\/api\/v2\/books\/page\/([^/?#]+)\/([^/?#]+)/);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return {
    chapterId: decodeURIComponent(match[1]),
    fileName: decodeURIComponent(match[2]),
  };
}

function getDataSaver(): boolean {
  return (Application.getState(DATA_SAVER_KEY) as boolean | undefined) ?? false;
}

export async function getChallengeResponse(
  chapterId: string,
  forceRefresh = false,
): Promise<ChallengeDto> {
  const integrityToken = await getIntegrityToken(forceRefresh);
  try {
    return await requestChallengeResponse(chapterId, integrityToken);
  } catch (error) {
    clearIntegrityToken();
    const refreshedToken = await getIntegrityToken(true);
    try {
      return await requestChallengeResponse(chapterId, refreshedToken);
    } catch (retryError) {
      throw retryError instanceof Error ? retryError : error;
    }
  }
}

async function requestChallengeResponse(
  chapterId: string,
  integrityToken: string,
): Promise<ChallengeDto> {
  const url = new URL(API_URL)
    .addPathComponent("api")
    .addPathComponent("v2")
    .addPathComponent("books")
    .addPathComponent(chapterId)
    .setQueryItem("is_datasaver", String(getDataSaver()))
    .toString();

  return fetchJSON<ChallengeDto>({
    url,
    method: "POST",
    headers: apiHeaders({ "x-integrity-token": integrityToken }),
    body: "{}",
  });
}

async function getIntegrityToken(forceRefresh = false): Promise<string> {
  const exp = Number(Application.getState(INTEGRITY_EXP_KEY) ?? 0);
  const token = Application.getState(INTEGRITY_TOKEN_KEY);

  if (!forceRefresh && typeof token === "string" && token && exp > Date.now()) {
    return token;
  }

  await Application.scheduleRequest({
    url: `${BASE_URL}/`,
    method: "GET",
    headers: browserHeaders(),
  });

  const integrity = await fetchJSON<IntegrityDto>({
    url: `${BASE_URL}/api/integrity`,
    method: "POST",
    headers: apiHeaders(),
    body: "",
  });

  Application.setState(integrity.token, INTEGRITY_TOKEN_KEY);
  Application.setState(String(integrity.exp * 1000), INTEGRITY_EXP_KEY);

  return integrity.token;
}

function clearIntegrityToken(): void {
  Application.setState("", INTEGRITY_TOKEN_KEY);
  Application.setState("0", INTEGRITY_EXP_KEY);
}

export function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    accept: "application/json",
    "content-type": "application/json",
    origin: BASE_URL,
    referer: `${BASE_URL}/`,
    ...extra,
  };
}

export function browserHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    referer: `${BASE_URL}/`,
    ...extra,
  };
}

export async function fetchJSON<T>(request: Request): Promise<T> {
  const [response, buffer] = await Application.scheduleRequest(request);

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${request.url}`);
  }

  const data = Application.arrayBufferToUTF8String(buffer);
  const text = typeof data === "string" ? data : String(data);

  try {
    return JSON.parse(text) as T;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${request.url}: ${reason}`);
  }
}

export async function getKaganeMetadata(): Promise<KaganeMetadata> {
  const cacheDate = Number(Application.getState(METADATA_CACHE_DATE_KEY) ?? 0);
  const cached = Application.getState(METADATA_CACHE_KEY);

  if (typeof cached === "string" && cacheDate + METADATA_CACHE_TTL_SECONDS > Date.now() / 1000) {
    try {
      return JSON.parse(cached) as KaganeMetadata;
    } catch {
      Application.setState("", METADATA_CACHE_KEY);
      Application.setState("0", METADATA_CACHE_DATE_KEY);
    }
  }

  const [genres, sources] = await Promise.all([
    fetchJSON<GenreDto[]>({
      url: `${API_URL}/api/v2/genres/list`,
      method: "GET",
      headers: apiHeaders(),
    }),
    fetchJSON<SourcesDto>({
      url: `${API_URL}/api/v2/sources/list`,
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ source_types: null }),
    }),
  ]);

  const metadata: KaganeMetadata = {
    genres: Object.fromEntries(genres.map((genre) => [genre.id, genre.genre_name])),
    sources: sources.sources ?? [],
  };

  Application.setState(JSON.stringify(metadata), METADATA_CACHE_KEY);
  Application.setState(String(Date.now() / 1000), METADATA_CACHE_DATE_KEY);

  return metadata;
}
