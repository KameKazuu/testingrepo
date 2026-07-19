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
  TAGS_CACHE_DATE_KEY,
  TAGS_CACHE_KEY,
  type ChallengeDto,
  type GenreDto,
  type IntegrityDto,
  type KaganeMetadata,
  type SourcesDto,
  type TagDto,
} from "../implementations/shared/models";
import { buildPageUrl } from "../implementations/shared/utils";

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
  // Cloudflare challenges the browse/search POSTs as well as navigations
  // (they come back with cf-mitigated: challenge), so every same-origin
  // request must be able to raise the bypass — otherwise discover breaks. The
  // managed challenge is solved in the WebView under the device User-Agent,
  // and the resulting cf_clearance is reused across methods, so this does not
  // loop.
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
  // A successful page load never needs a retry. Skip the body scan on 2xx —
  // stringifying every multi-megabyte page image to regex-check it stalls the
  // reader's prefetch for nothing (image loads run through this interceptor).
  if (response.status >= 200 && response.status < 300) {
    return false;
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

  // Reuse the cached integrity token — getChallengeResponse refreshes it once
  // on its own if it's actually stale. Forcing a refresh here meant every
  // failed prefetched page kicked off its own homepage + integrity + challenge
  // round-trip, flooding the API when a whole batch expired at once.
  const challenge = await getChallengeResponse(parts.chapterId);
  const cacheUrl = challenge.cache_url || DEFAULT_CACHE_URL;
  const retryUrl = buildPageUrl(
    cacheUrl,
    parts.chapterId,
    parts.fileName,
    challenge.access_token,
    getDataSaver(),
  );

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
  // Tolerate the optional data-saver path segment: /page/[datasaver/]{id}/{file}
  const match = url.match(/\/api\/v2\/books\/page\/(?:datasaver\/)?([^/?#]+)\/([^/?#]+)/);
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

  await scheduleWithRetry({
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

// The origin sheds connections under load: pooled keep-alive sockets die
// ("network connection lost") and new connections get refused outright. One
// short retry absorbs those transient socket deaths. A CloudflareError must
// pass straight through, or the bypass would never be raised.
async function scheduleWithRetry(request: Request): Promise<[Response, ArrayBuffer]> {
  try {
    return await Application.scheduleRequest(request);
  } catch (error) {
    if (error instanceof CloudflareError) throw error;
    await Application.sleep(1);
    return Application.scheduleRequest(request);
  }
}

export async function fetchJSON<T>(request: Request): Promise<T> {
  const [response, buffer] = await scheduleWithRetry(request);

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

  // Fetched one after another rather than in parallel: on a cold load the first
  // clears any Cloudflare challenge (raising the bypass once) so the second
  // rides the fresh clearance, instead of both hitting the challenge at once.
  const genres = await fetchJSON<GenreDto[]>({
    url: `${API_URL}/api/v2/genres/list`,
    method: "GET",
    headers: apiHeaders(),
  });
  const sources = await fetchJSON<SourcesDto>({
    url: `${API_URL}/api/v2/sources/list`,
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ source_types: null }),
  });

  const metadata: KaganeMetadata = {
    genres: Object.fromEntries(genres.map((genre) => [genre.id, genre.genre_name])),
    sources: sources.sources ?? [],
  };

  Application.setState(JSON.stringify(metadata), METADATA_CACHE_KEY);
  Application.setState(String(Date.now() / 1000), METADATA_CACHE_DATE_KEY);

  return metadata;
}

// The last metadata we cached, ignoring the freshness window. Used as a
// fallback so UI that needs the genre taxonomy (e.g. the settings form) can
// still populate when a live refresh fails.
export function readCachedMetadata(): KaganeMetadata | undefined {
  const cached = Application.getState(METADATA_CACHE_KEY);
  if (typeof cached === "string" && cached) {
    try {
      return JSON.parse(cached) as KaganeMetadata;
    } catch {
      // Corrupt cache — ignore.
    }
  }
  return undefined;
}

// The tag taxonomy is thousands of entries, so it is fetched lazily — only when
// a tag search is actually run — and cached for a day. Returns a lower-cased
// name → UUID map so tag names can be resolved to the ids the search expects.
export async function getKaganeTags(): Promise<Record<string, string>> {
  const cacheDate = Number(Application.getState(TAGS_CACHE_DATE_KEY) ?? 0);
  const cached = Application.getState(TAGS_CACHE_KEY);

  if (typeof cached === "string" && cacheDate + METADATA_CACHE_TTL_SECONDS > Date.now() / 1000) {
    try {
      return JSON.parse(cached) as Record<string, string>;
    } catch {
      Application.setState("", TAGS_CACHE_KEY);
      Application.setState("0", TAGS_CACHE_DATE_KEY);
    }
  }

  const tags = await fetchJSON<TagDto[]>({
    url: `${API_URL}/api/v2/tags/list`,
    method: "GET",
    headers: apiHeaders(),
  });

  const map: Record<string, string> = {};
  for (const tag of tags) {
    if (tag.tag_name && tag.id) {
      map[tag.tag_name.toLowerCase()] = tag.id;
    }
  }

  Application.setState(JSON.stringify(map), TAGS_CACHE_KEY);
  Application.setState(String(Date.now() / 1000), TAGS_CACHE_DATE_KEY);

  return map;
}
