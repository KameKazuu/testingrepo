/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
} from "@paperback/types";

import { getApiUrl, getDomain } from "./forms/settings";
import { type ResponseDto } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|avif|bmp|svg)(\?|#|$)/i;

export class ScansGGInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const domain = getDomain();
    // Image CDN requests want a browser-like image `accept`; API/JSON requests
    // want the JSON one. Sending the wrong accept for the target is an
    // anomalous, bot-like signal that can needlessly trip Cloudflare.
    const accept = IMAGE_EXTENSION_REGEX.test(request.url)
      ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
      : "application/json, text/plain, */*";

    return {
      ...request,
      headers: {
        ...request.headers,
        origin: domain,
        referer: `${domain}/`,
        "user-agent": await Application.getDefaultUserAgent(),
        accept,
        "accept-language": "en-US,en;q=0.5",
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (response.headers?.["cf-mitigated"] === "challenge") {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": await Application.getDefaultUserAgent() },
      });
    }
    return data;
  }
}

/** A single query value; arrays are joined into the `[a,b,c]` form the API uses. */
export type QueryValue = string | number | boolean | string[];

/**
 * GET a JSON endpoint under the API host and return its `data` payload.
 * Query values are appended in insertion order; `undefined` values are skipped.
 */
export async function fetchApi<T>(
  path: string,
  query: Record<string, QueryValue | undefined> = {},
): Promise<ResponseDto<T>> {
  const builder = new URL(getApiUrl()).addPathComponent(path);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    const serialized = Array.isArray(value) ? `[${value.join(",")}]` : String(value);
    builder.setQueryItem(key, serialized);
  }
  const url = builder.toString();

  const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status === 404) {
    throw new Error(`Content not found: ${url}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }

  const text = Application.arrayBufferToUTF8String(buffer);
  try {
    return JSON.parse(text) as ResponseDto<T>;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${url}: ${reason}`);
  }
}
