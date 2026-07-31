/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type Cookie, PaperbackInterceptor, type Request, type Response } from "@paperback/types";

import {
  ACCESS_TOKEN_KEY,
  API_URL,
  DEFAULT_RATING_STEPS,
  DOMAIN,
  RATING_STEPS_KEY,
  REFRESH_TOKEN_KEY,
  SESSION_KEY,
  TOKEN_KEY,
} from "./models";

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

// Swap the stored OAuth pair. Returns false when there is nothing to swap.
export function swapAccessTokens(): boolean {
  const access = Application.getSecureState(ACCESS_TOKEN_KEY) as string | null;
  const refresh = Application.getSecureState(REFRESH_TOKEN_KEY) as string | null;
  if (!access || !refresh) return false;

  Application.setSecureState(refresh, ACCESS_TOKEN_KEY);
  Application.setSecureState(access, REFRESH_TOKEN_KEY);
  return true;
}

// The API documents `session` alongside `oauth` and `pat` as a way to
// authenticate, so the cookies a browser login leaves behind are kept and
// replayed on the `/my/` endpoints.
export function getSessionCookie(): string | undefined {
  const cookie = Application.getSecureState(SESSION_KEY) as string | null;
  return cookie ? String(cookie) : undefined;
}

export function setSessionCookies(cookies: Cookie[]): void {
  const header = cookies
    .filter((cookie) => cookie.domain.replace(/^\./, "").endsWith("mangabaka.org"))
    .filter((cookie) => cookie.name && cookie.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  if (header) {
    Application.setSecureState(header, SESSION_KEY);
  }
}

export function clearToken(): void {
  Application.setSecureState(null, TOKEN_KEY);
  Application.setSecureState(null, ACCESS_TOKEN_KEY);
  Application.setSecureState(null, REFRESH_TOKEN_KEY);
  Application.setSecureState(null, SESSION_KEY);
}

export function getRatingSteps(): number {
  const steps = Application.getState(RATING_STEPS_KEY) as number | undefined;
  return typeof steps === "number" && steps > 0 ? steps : DEFAULT_RATING_STEPS;
}

export function setRatingSteps(steps: number | null | undefined): void {
  if (typeof steps === "number" && steps > 0) {
    Application.setState(steps, RATING_STEPS_KEY);
  }
}

export function isAuthenticated(): boolean {
  return (
    getAccessToken() != undefined || getToken() != undefined || getSessionCookie() != undefined
  );
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

  const session = getSessionCookie();
  return session ? { cookie: session } : {};
}

export function assertAuthenticated(): Record<string, string> {
  const headers = authHeaders();
  if (Object.keys(headers).length === 0) {
    throw new Error("You are not authenticated, please log in through the MangaBaka settings");
  }
  return headers;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  needsAuth?: boolean;
}

// Every endpoint answers `{ status, data }`; `data` is returned directly.
export async function makeRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, needsAuth = false } = options;

  const headers: Record<string, string> = { accept: "application/json" };
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

  if (response.status === 401 || response.status === 403) {
    throw new Error("MangaBaka rejected your access token, please add a new one in the settings");
  }
  if (response.status === 404) {
    throw new Error(`[404] Not found: ${path}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`MangaBaka returned status ${response.status} for ${path}`);
  }

  const text = Application.arrayBufferToUTF8String(buffer);
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}
