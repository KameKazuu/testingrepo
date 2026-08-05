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

let integrityTokenPromise: Promise<string> | undefined;
const challengePromises = new Map<string, Promise<ChallengeDto>>();
let metadataPromise: Promise<KaganeMetadata> | undefined;

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
      // Always raise the bypass against the canonical homepage GET rather than
      // the failing API call: solving it there mints the domain-wide
      // cf_clearance, and identical bypass requests collapse into one prompt
      // instead of one per challenged section on a cold discover load.
      throw new CloudflareError({
        url: `${BASE_URL}/`,
        method: "GET",
        headers: {
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

function responseHeader(response: Response, name: string): string {
  const key = Object.keys(response.headers ?? {}).find(
    (header) => header.toLowerCase() === name.toLowerCase(),
  );
  return key ? (response.headers?.[key] ?? "") : "";
}

async function isCloudflareChallenge(
  request: Request,
  response: Response,
  data: ArrayBuffer,
): Promise<boolean> {
  if (!request.url.startsWith(BASE_URL)) {
    return false;
  }

  // cf-mitigated is the strongest signal and can appear on API POSTs too.
  if (responseHeader(response, "cf-mitigated").toLowerCase() === "challenge") {
    return true;
  }

  // Kagane also uses ordinary JSON 403/503 responses for expired reader
  // tokens, rate limits, and outages. Do not turn those into a WebView prompt.
  if (response.status !== 403 && response.status !== 503) {
    return false;
  }

  const contentType = responseHeader(response, "content-type").toLowerCase();
  if (contentType.includes("application/json")) return false;
  const text = Application.arrayBufferToUTF8String(data);
  if (typeof text !== "string") return false;
  const looksHtml = contentType.includes("text/html") || /^\s*(?:<!doctype html|<html)/i.test(text);
  return (
    looksHtml &&
    /cf-browser-verification|cf-challenge|cf-chl-|_cf_chl_opt|Just a moment/i.test(text)
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

export function getChallengeResponse(
  chapterId: string,
  forceRefresh = false,
): Promise<ChallengeDto> {
  const existing = challengePromises.get(chapterId);
  if (existing) return existing;

  const request = loadChallengeResponse(chapterId, forceRefresh);
  challengePromises.set(chapterId, request);
  request.then(
    () => {
      if (challengePromises.get(chapterId) === request) challengePromises.delete(chapterId);
    },
    () => {
      if (challengePromises.get(chapterId) === request) challengePromises.delete(chapterId);
    },
  );
  return request;
}

async function loadChallengeResponse(
  chapterId: string,
  forceRefresh: boolean,
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

function getIntegrityToken(forceRefresh = false): Promise<string> {
  const exp = Number(Application.getState(INTEGRITY_EXP_KEY) ?? 0);
  const token = Application.getState(INTEGRITY_TOKEN_KEY);

  if (!forceRefresh && typeof token === "string" && token && exp > Date.now()) {
    return Promise.resolve(token);
  }
  if (integrityTokenPromise) return integrityTokenPromise;
  if (forceRefresh) clearIntegrityToken();

  const request = refreshIntegrityToken();
  integrityTokenPromise = request;
  request.then(
    () => {
      if (integrityTokenPromise === request) integrityTokenPromise = undefined;
    },
    () => {
      if (integrityTokenPromise === request) integrityTokenPromise = undefined;
    },
  );
  return request;
}

async function refreshIntegrityToken(): Promise<string> {
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

function retryDelaySeconds(response: Response): number {
  const retryAfter = responseHeader(response, "retry-after").trim();
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(10, Math.max(1, seconds));
  }
  const date = Date.parse(retryAfter);
  if (Number.isFinite(date)) {
    return Math.min(10, Math.max(1, Math.ceil((date - Date.now()) / 1000)));
  }
  return response.status === 429 ? 2 : 1;
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
  let result = await scheduleWithRetry(request);
  if (result[0].status === 429 || result[0].status === 503) {
    await Application.sleep(retryDelaySeconds(result[0]));
    result = await scheduleWithRetry(request);
  }
  const [response, buffer] = result;

  if (response.status < 200 || response.status >= 300) {
    if (response.status === 429) {
      throw new Error("Kagane is rate limiting requests. Try again shortly.");
    }
    if (response.status === 503) {
      throw new Error("Kagane is temporarily unavailable. Try again shortly.");
    }
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

export function getKaganeMetadata(): Promise<KaganeMetadata> {
  const cacheDate = Number(Application.getState(METADATA_CACHE_DATE_KEY) ?? 0);
  const cached = Application.getState(METADATA_CACHE_KEY);

  if (typeof cached === "string" && cacheDate + METADATA_CACHE_TTL_SECONDS > Date.now() / 1000) {
    try {
      return Promise.resolve(JSON.parse(cached) as KaganeMetadata);
    } catch {
      Application.setState("", METADATA_CACHE_KEY);
      Application.setState("0", METADATA_CACHE_DATE_KEY);
    }
  }

  if (metadataPromise) return metadataPromise;
  const request = loadKaganeMetadata();
  metadataPromise = request;
  request.then(
    () => {
      if (metadataPromise === request) metadataPromise = undefined;
    },
    () => {
      if (metadataPromise === request) metadataPromise = undefined;
    },
  );
  return request;
}

async function loadKaganeMetadata(): Promise<KaganeMetadata> {
  // Keep the two vocabulary requests sequential so the first can clear a real
  // challenge. Every provider shares this one in-flight operation.
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

// The tag taxonomy is thousands of entries, fetched lazily — when a tag
// search runs or the filter sheet opens. The primary cache is in-memory;
// persisting ~700KB to state storage is strictly best-effort and must never
// fail the caller (a failed setState after a successful fetch is exactly what
// kept the Tags filter from ever appearing).
let tagEntriesMemo: TagDto[] | undefined;

export async function getKaganeTagEntries(): Promise<TagDto[]> {
  if (tagEntriesMemo) {
    return tagEntriesMemo;
  }

  const cacheDate = Number(Application.getState(TAGS_CACHE_DATE_KEY) ?? 0);
  const cached = Application.getState(TAGS_CACHE_KEY);
  if (typeof cached === "string" && cacheDate + METADATA_CACHE_TTL_SECONDS > Date.now() / 1000) {
    try {
      const parsed: unknown = JSON.parse(cached);
      // Older builds cached a name→id object under this key — only an array
      // of entries is valid; anything else is refetched.
      if (Array.isArray(parsed) && parsed.length > 0) {
        tagEntriesMemo = parsed as TagDto[];
        return tagEntriesMemo;
      }
    } catch {
      // Corrupt cache — refetch below.
    }
  }

  const tags = await fetchJSON<TagDto[]>({
    url: `${API_URL}/api/v2/tags/list`,
    method: "GET",
    headers: apiHeaders(),
  });
  const entries = tags
    .filter((tag) => Boolean(tag.id && tag.tag_name))
    .map((tag) => ({ id: tag.id, tag_name: tag.tag_name }));
  tagEntriesMemo = entries;

  try {
    Application.setState(JSON.stringify(entries), TAGS_CACHE_KEY);
    Application.setState(String(Date.now() / 1000), TAGS_CACHE_DATE_KEY);
  } catch (error) {
    console.log(`[Kagane] tag cache persist failed (memory cache active): ${String(error)}`);
  }

  return entries;
}

// Fire-and-forget warm-up so the taxonomy is already in memory when the
// filter sheet opens (mirrors the reference behavior of preloading tags
// during the initial home load). Every failure is swallowed — a background
// warm-up must never surface errors or raise the Cloudflare bypass; the
// filter sheet fetches live if this didn't land.
export function warmTagTaxonomy(): void {
  void getKaganeTagEntries().catch(() => undefined);
}

// Lower-cased name → UUID map for resolving typed tag names to the ids the
// search expects.
export async function getKaganeTags(): Promise<Record<string, string>> {
  const entries = await getKaganeTagEntries();
  const map: Record<string, string> = {};
  for (const tag of entries) {
    map[tag.tag_name.toLowerCase()] = tag.id;
  }
  return map;
}
