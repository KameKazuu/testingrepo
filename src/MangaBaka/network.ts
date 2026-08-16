/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { PaperbackInterceptor, type Cookie, type Request, type Response } from "@paperback/types";

import {
  ACCESS_TOKEN_KEY,
  API_URL,
  DEFAULT_RATING_STEPS,
  DEFAULT_LIBRARY_STATE,
  DOMAIN,
  type Envelope,
  GENRES_CACHE_KEY,
  LIBRARY_STATES,
  OAUTH_AUTHORIZE_URL,
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_URI,
  OAUTH_SCOPES,
  OAUTH_TOKEN_URL,
  PROFILE_KEY,
  type Profile,
  RATING_STEPS_KEY,
  REFRESH_TOKEN_KEY,
  type TagDefinition,
  TOKEN_KEY,
} from "./models";
import { createPkceSession, type PkceSession } from "./utils";

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
  clearAccessTokens();
}

export function getAccessToken(): string | undefined {
  const token = Application.getSecureState(ACCESS_TOKEN_KEY) as string | null;
  return token ? String(token) : undefined;
}

export function setAccessTokens(accessToken: string, refreshToken?: string): void {
  Application.setSecureState(accessToken, ACCESS_TOKEN_KEY);
  Application.setSecureState(refreshToken ?? null, REFRESH_TOKEN_KEY);
  Application.setSecureState(null, TOKEN_KEY);
}

const clearAccessTokens = (): void => {
  Application.setSecureState(null, ACCESS_TOKEN_KEY);
  Application.setSecureState(null, REFRESH_TOKEN_KEY);
};

function getRefreshToken(): string | undefined {
  const token = Application.getSecureState(REFRESH_TOKEN_KEY) as string | null;
  return token ? String(token) : undefined;
}

export function clearToken(): void {
  Application.setSecureState(null, TOKEN_KEY);
  clearAccessTokens();
  Application.setState(null, PROFILE_KEY);
  Application.setState(null, RATING_STEPS_KEY);
}

export function getProfile(): Profile | undefined {
  const stored = Application.getState(PROFILE_KEY);
  if (typeof stored !== "string") return undefined;

  try {
    const profile = JSON.parse(stored) as Profile;
    return profile && typeof profile === "object" ? profile : undefined;
  } catch {
    return undefined;
  }
}

export function setProfile(profile: Profile): void {
  Application.setState(JSON.stringify(profile), PROFILE_KEY);
  setRatingSteps(profile.rating_steps);
}

export function getDefaultLibraryState(): string {
  const state = getProfile()?.library_default_state;
  return LIBRARY_STATES.some((option) => option.id === state) ? state! : DEFAULT_LIBRARY_STATE;
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

export async function refreshProfile(): Promise<Profile> {
  const response = await makeRequest<Envelope<Profile>>("/v1/my/profile", { needsAuth: true });
  setProfile(response.data);
  return response.data;
}

export function isAuthenticated(): boolean {
  return getAccessToken() != undefined || getToken() != undefined;
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

const encodeForm = (params: Record<string, string>): string =>
  Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

const buildAuthorizeUrl = (session: PkceSession, prompt: "consent" | "none"): string =>
  `${OAUTH_AUTHORIZE_URL}?${encodeForm({
    client_id: OAUTH_CLIENT_ID,
    response_type: "code",
    redirect_uri: OAUTH_REDIRECT_URI,
    scope: OAUTH_SCOPES.join(" "),
    state: session.state,
    code_challenge: session.challenge,
    code_challenge_method: "S256",
    prompt,
  })}`;

export async function prepareOAuthAuthorizeUrl(): Promise<string> {
  return buildAuthorizeUrl(await createPkceSession(), "consent");
}

const headerValue = (headers: Record<string, string>, name: string): string | undefined => {
  const target = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1];
};

const parseSetCookie = (header: string | undefined): [string, string][] => {
  if (!header) return [];

  const cookies: [string, string][] = [];
  for (const part of header.split(/,(?=\s*[A-Za-z0-9!#$%&'*+\-.^_`|~]+=)/)) {
    const pair = part.split(";")[0]?.trim();
    const separator = pair?.indexOf("=") ?? -1;
    if (pair == undefined || separator <= 0) continue;

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name && value) cookies.push([name, value]);
  }
  return cookies;
};

const parseQuery = (url: string): Record<string, string> => {
  const start = url.indexOf("?");
  if (start === -1) return {};

  const end = url.indexOf("#", start);
  const query = url.slice(start + 1, end === -1 ? undefined : end);
  const result: Record<string, string> = {};

  for (const pair of query.split("&")) {
    if (!pair) continue;
    const separator = pair.indexOf("=");
    const key = separator === -1 ? pair : pair.slice(0, separator);
    const value = separator === -1 ? "" : pair.slice(separator + 1);
    result[decodeURIComponent(key.replace(/\+/g, " "))] = decodeURIComponent(
      value.replace(/\+/g, " "),
    );
  }

  return result;
};

const redirectFromBody = (text: string): string | undefined => {
  try {
    const payload = JSON.parse(text) as Record<string, unknown>;
    const redirect = payload.redirectURI ?? payload.redirect_uri ?? payload.url;
    return typeof redirect === "string" ? redirect : undefined;
  } catch {
    return undefined;
  }
};

const absoluteAuthUrl = (url: string): string => {
  if (url.startsWith("http")) return url;
  return `${DOMAIN}${url.startsWith("/") ? "" : "/"}${url}`;
};

const authorizationCode = async (cookies: Cookie[], session: PkceSession): Promise<string> => {
  const jar = new Map<string, string>();
  for (const cookie of cookies) {
    const domain = cookie.domain.replace(/^\./, "").toLowerCase();
    if (domain === "mangabaka.org" || domain.endsWith(".mangabaka.org")) {
      jar.set(cookie.name, cookie.value);
    }
  }
  if (jar.size === 0) {
    throw new Error("No MangaBaka login cookies were captured. Please try again.");
  }

  let url = buildAuthorizeUrl(session, "none");
  for (let hop = 0; hop < 3; hop++) {
    const [response, buffer] = await Application.scheduleRequest({
      url,
      method: "GET",
      headers: {
        accept: "application/json, text/html",
        cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
      },
    });

    for (const cookie of response.cookies) jar.set(cookie.name, cookie.value);
    for (const [name, value] of parseSetCookie(headerValue(response.headers, "set-cookie"))) {
      jar.set(name, value);
    }

    const text = Application.arrayBufferToUTF8String(buffer);
    const redirect = headerValue(response.headers, "location") ?? redirectFromBody(text);
    if (!redirect) {
      throw new Error(`MangaBaka login stopped at HTTP ${response.status}.`);
    }

    if (redirect.startsWith(OAUTH_REDIRECT_URI)) {
      const query = parseQuery(redirect);
      if (query.state !== session.state) throw new Error("MangaBaka login state did not match.");
      if (query.iss && query.iss !== `${DOMAIN}/auth`) {
        throw new Error("MangaBaka login returned an unexpected issuer.");
      }
      if (query.code) return query.code;

      const detail = query.error_description ?? query.error;
      throw new Error(detail ? `MangaBaka refused login: ${detail}` : "MangaBaka refused login.");
    }

    if (/\/(auth|consent)(\?|$)/.test(redirect)) {
      throw new Error("Approve access in MangaBaka, then close the login window with Done.");
    }
    url = absoluteAuthUrl(redirect);
  }

  throw new Error("MangaBaka login returned too many redirects.");
};

interface OAuthTokenPayload {
  access_token?: unknown;
  refresh_token?: unknown;
  error?: unknown;
  error_description?: unknown;
}

const exchangeAuthorizationCode = async (
  code: string,
  verifier: string,
): Promise<{ accessToken: string; refreshToken?: string }> => {
  const [response, buffer] = await Application.scheduleRequest({
    url: OAUTH_TOKEN_URL,
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: encodeForm({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
    }),
  });
  const text = Application.arrayBufferToUTF8String(buffer);

  let payload: OAuthTokenPayload;
  try {
    payload = JSON.parse(text) as OAuthTokenPayload;
  } catch {
    throw new Error(`MangaBaka returned an unreadable login response (HTTP ${response.status}).`);
  }

  if (typeof payload.access_token !== "string" || !payload.access_token) {
    const detail =
      typeof payload.error_description === "string"
        ? payload.error_description
        : typeof payload.error === "string"
          ? payload.error
          : `HTTP ${response.status}`;
    throw new Error(`MangaBaka rejected login: ${detail}`);
  }

  return {
    accessToken: payload.access_token,
    ...(typeof payload.refresh_token === "string" && payload.refresh_token
      ? { refreshToken: payload.refresh_token }
      : {}),
  };
};

export async function loginWithCookies(cookies: Cookie[]): Promise<void> {
  const session = await createPkceSession();
  const code = await authorizationCode(cookies, session);
  const tokens = await exchangeAuthorizationCode(code, session.verifier);
  const probe = await scheduleApiRequest("/v1/my/library/1", {
    headers: { authorization: `Bearer ${tokens.accessToken}` },
  });

  if (probe.status !== 200 && probe.status !== 404) {
    throw new Error(`MangaBaka rejected the new login (HTTP ${probe.status}).`);
  }

  setAccessTokens(tokens.accessToken, tokens.refreshToken);
  try {
    await refreshProfile();
  } catch {
    // The library token is authoritative; profile information is optional.
  }
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

  let tokens: OAuthTokenPayload;
  try {
    tokens = JSON.parse(text) as OAuthTokenPayload;
  } catch {
    clearAccessTokens();
    throw new MangaBakaError(401, "MangaBaka did not return refreshed credentials");
  }
  if (typeof tokens.access_token !== "string" || !tokens.access_token) {
    clearAccessTokens();
    throw new MangaBakaError(401, "MangaBaka did not return a refreshed access token");
  }
  setAccessTokens(
    tokens.access_token,
    typeof tokens.refresh_token === "string" ? tokens.refresh_token : refreshToken,
  );
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
