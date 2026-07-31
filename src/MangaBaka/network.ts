/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CookieStorageInterceptor,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import {
  ACCESS_TOKEN_KEY,
  API_URL,
  DEFAULT_RATING_STEPS,
  DOMAIN,
  type Envelope,
  GENRES_CACHE_KEY,
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_URI,
  OAUTH_TOKEN_URL,
  type OAuthTokenResponse,
  RATING_STEPS_KEY,
  REFRESH_TOKEN_KEY,
  SESSION_KEY,
  type TagDefinition,
  TOKEN_KEY,
} from "./models";

export const cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

export class MangaBakaInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        "user-agent": await Application.getDefaultUserAgent(),
      },
    };
  }

  override async interceptResponse(
    _request: Request,
    _response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    return data;
  }
}

export function getToken(): string | undefined {
  const token = Application.getSecureState(TOKEN_KEY) as string | null;
  return token ? String(token) : undefined;
}

export function setToken(token: string): void {
  Application.setSecureState(token, TOKEN_KEY);
}

export function getAccessToken(): string | undefined {
  const token = Application.getSecureState(ACCESS_TOKEN_KEY) as string | null;
  return token ? String(token) : undefined;
}

export function setAccessTokens(accessToken: string, refreshToken?: string): void {
  Application.setSecureState(accessToken, ACCESS_TOKEN_KEY);
  if (refreshToken) {
    Application.setSecureState(refreshToken, REFRESH_TOKEN_KEY);
  }
}

const clearAccessTokens = (): void => {
  Application.setSecureState(null, ACCESS_TOKEN_KEY);
  Application.setSecureState(null, REFRESH_TOKEN_KEY);
};

function getRefreshToken(): string | undefined {
  const token = Application.getSecureState(REFRESH_TOKEN_KEY) as string | null;
  return token ? String(token) : undefined;
}

function hasSession(): boolean {
  return Application.getSecureState(SESSION_KEY) === true;
}

export function setSessionAuthenticated(): void {
  Application.setSecureState(true, SESSION_KEY);
}

export function clearToken(): void {
  Application.setSecureState(null, TOKEN_KEY);
  clearAccessTokens();
  Application.setSecureState(null, SESSION_KEY);
  cookieStorage.cookies = [];
}

export function getRatingSteps(): number {
  const steps = Application.getState(RATING_STEPS_KEY) as number | undefined;
  return typeof steps === "number" && steps > 0 ? steps : DEFAULT_RATING_STEPS;
}

export function hasRatingSteps(): boolean {
  return typeof Application.getState(RATING_STEPS_KEY) === "number";
}

// Genres are the tags carrying `is_genre`. The list is public, cached, and
// changes about as often as the catalog schema does, so it is kept.
export async function getGenreOptions(): Promise<{ id: string; title: string }[]> {
  const cached = Application.getState(GENRES_CACHE_KEY) as
    | { id: string; title: string }[]
    | undefined;
  if (cached != undefined && cached.length > 0) return cached;

  const response = await makeRequest<Envelope<TagDefinition[]>>("/v1/tags");
  const options = (response.data ?? [])
    // A merged tag's id no longer matches anything.
    .filter((tag) => tag.is_genre === true && tag.merged_with == undefined && tag.name)
    .map((tag) => ({ id: String(tag.id), title: tag.name }))
    // Compared directly rather than through `localeCompare`, which leans on a
    // collator the runtime may not carry.
    .sort((left, right) => {
      const a = left.title.toLowerCase();
      const b = right.title.toLowerCase();
      return a < b ? -1 : a > b ? 1 : 0;
    });

  Application.setState(options, GENRES_CACHE_KEY);
  return options;
}

export function setRatingSteps(steps: number | null | undefined): void {
  if (typeof steps === "number" && steps > 0) {
    Application.setState(steps, RATING_STEPS_KEY);
  }
}

export function isAuthenticated(): boolean {
  return getAccessToken() != undefined || getToken() != undefined || hasSession();
}

// OAuth access tokens are bearer credentials; a personal access token is sent
// in the header the API documents for it instead. Only the `/my/` endpoints
// take these: the rest of the API is public and cached in front of the
// backend, where credentials are ignored and would only cost a backend hit.
function authHeaders(): Record<string, string> {
  const accessToken = getAccessToken();
  if (accessToken) {
    return { authorization: `Bearer ${accessToken}` };
  }

  const token = getToken();
  if (token) {
    return { "x-api-key": token };
  }

  return {};
}

export function assertAuthenticated(): Record<string, string> {
  if (!isAuthenticated()) {
    throw new Error("You are not authenticated, please log in through the MangaBaka settings");
  }

  const headers = authHeaders();
  return headers;
}

export class MangaBakaError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// A rate limit, an outage or a credential the user can repair are all reasons
// to come back later rather than to record a permanent failure.
export function shouldRetryLater(error: unknown): boolean {
  if (!(error instanceof MangaBakaError)) return true;
  return (
    error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500
  );
}

// Errors answer with the same envelope as everything else, and its `message`
// is written to be shown to the reader, so prefer it over anything made up
// here.
function errorMessage(status: number, text: string): string {
  try {
    const payload = JSON.parse(text) as { message?: string };
    if (payload.message) return payload.message;
  } catch {
    // Not the documented envelope; fall through to the generic wording.
  }

  if (status === 401 || status === 403) {
    return "MangaBaka rejected your credentials, please sign in again in the settings";
  }
  return `MangaBaka returned status ${status}`;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  needsAuth?: boolean;
  headers?: Record<string, string>;
}

interface ScheduledResponse {
  status: number;
  text: string;
}

const scheduleApiRequest = async (
  path: string,
  options: RequestOptions,
): Promise<ScheduledResponse> => {
  const { method = "GET", body, needsAuth = false, headers: suppliedHeaders } = options;

  const headers: Record<string, string> = { accept: "application/json", ...suppliedHeaders };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (needsAuth) {
    Object.assign(headers, assertAuthenticated());
  }

  const request: Request = {
    url: `${API_URL}${path}`,
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  };

  const [response, buffer] = await Application.scheduleRequest(request);
  return { status: response.status, text: Application.arrayBufferToUTF8String(buffer) };
};

let refreshPromise: Promise<void> | undefined;

const refreshAccessToken = async (): Promise<void> => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new MangaBakaError(401, "Your MangaBaka session expired, please sign in again");
  }

  const body = [
    "grant_type=refresh_token",
    `client_id=${encodeURIComponent(OAUTH_CLIENT_ID)}`,
    `refresh_token=${encodeURIComponent(refreshToken)}`,
    `redirect_uri=${encodeURIComponent(OAUTH_REDIRECT_URI)}`,
  ].join("&");
  const [response, buffer] = await Application.scheduleRequest({
    url: OAUTH_TOKEN_URL,
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = Application.arrayBufferToUTF8String(buffer);

  if (response.status < 200 || response.status >= 300) {
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      clearAccessTokens();
      throw new MangaBakaError(401, "Your MangaBaka session expired, please sign in again");
    }
    throw new MangaBakaError(response.status, errorMessage(response.status, text));
  }

  let tokens: OAuthTokenResponse;
  try {
    tokens = JSON.parse(text) as OAuthTokenResponse;
  } catch {
    clearAccessTokens();
    throw new MangaBakaError(401, "MangaBaka did not return refreshed credentials");
  }
  if (!tokens.access_token) {
    clearAccessTokens();
    throw new MangaBakaError(401, "MangaBaka did not return a refreshed access token");
  }
  setAccessTokens(tokens.access_token, tokens.refresh_token ?? refreshToken);
};

const refreshOnce = async (): Promise<void> => {
  if (refreshPromise == undefined) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = undefined;
    });
  }
  await refreshPromise;
};

// Every API endpoint answers `{ status, data }`.
export async function makeRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let result = await scheduleApiRequest(path, options);

  if (
    options.needsAuth === true &&
    (result.status === 401 || result.status === 403) &&
    getAccessToken() != undefined &&
    getRefreshToken() != undefined
  ) {
    await refreshOnce();
    result = await scheduleApiRequest(path, options);
  }

  if (result.status < 200 || result.status >= 300) {
    throw new MangaBakaError(result.status, errorMessage(result.status, result.text));
  }
  if (!result.text) {
    return undefined as T;
  }

  return JSON.parse(result.text) as T;
}
