/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

import { API_URL, DOMAIN, TOKEN_KEY } from "./models";

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

export function clearToken(): void {
  Application.setSecureState(null, TOKEN_KEY);
}

export function assertAuthenticated(): string {
  const token = getToken();
  if (!token) {
    throw new Error(
      "You are not authenticated, please add your access token in the MangaBaka settings",
    );
  }
  return token;
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
    headers["x-api-key"] = assertAuthenticated();
  } else {
    const token = getToken();
    if (token) {
      headers["x-api-key"] = token;
    }
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
