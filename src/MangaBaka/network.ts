/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

import { ACCESS_TOKEN_KEY, API_URL, DOMAIN, REFRESH_TOKEN_KEY, TOKEN_KEY } from "./models";

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

export function clearToken(): void {
  Application.setSecureState(null, TOKEN_KEY);
  Application.setSecureState(null, ACCESS_TOKEN_KEY);
  Application.setSecureState(null, REFRESH_TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return getAccessToken() != undefined || getToken() != undefined;
}

// OAuth access tokens are bearer credentials; a personal access token is sent
// in the header the API documents for it instead.
function authHeaders(): Record<string, string> {
  const accessToken = getAccessToken();
  if (accessToken) {
    return { authorization: `Bearer ${accessToken}` };
  }

  const token = getToken();
  return token ? { "x-api-key": token } : {};
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
  Object.assign(headers, needsAuth ? assertAuthenticated() : authHeaders());

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
