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
import { USER_AGENT } from "./models";

const IMAGE_EXTENSION_REGEX = /\.(jpe?g|png|webp|gif|avif|bmp|jxl)(\?|#|$)/i;

// Markers that identify a Cloudflare interstitial ("Just a moment…" / "Verify
// you are human" / bot-fight block) returned as the response body instead of a
// managed-challenge header. Kagane's edge frequently answers the API with one
// of these as a bare 403, which never carries `cf-mitigated`, so the header
// check alone would miss it and the reader would just see a hard failure.
const CLOUDFLARE_BODY_MARKERS = [
  "_cf_chl_opt",
  "challenges.cloudflare.com",
  "cf-mitigated",
  "/cdn-cgi/challenge-platform",
  "Just a moment",
  "cf_chl_",
];

function looksLikeCloudflareChallenge(response: Response, data: ArrayBuffer): boolean {
  const headers = response.headers ?? {};
  if (headers["cf-mitigated"] === "challenge") return true;

  // Only text-scan the small challenge pages: a real JSON/image body on 200
  // never needs inspecting, and decoding image binaries would be wasteful.
  if (response.status !== 403 && response.status !== 503) return false;
  const server = (headers["server"] ?? "").toLowerCase();
  const hasCfSignal =
    server.includes("cloudflare") || "cf-ray" in headers || "cf-mitigated" in headers;
  if (!hasCfSignal) return false;

  const body = Application.arrayBufferToUTF8String(data);
  return CLOUDFLARE_BODY_MARKERS.some((marker) => body.includes(marker));
}

export class KaganeInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    const domain = getDomain();
    const isImage = IMAGE_EXTENSION_REGEX.test(request.url);
    const isApi = request.url.startsWith(getApiUrl());

    // Match what the site's own reader sends for each request class (captured
    // traffic) so ours is indistinguishable — a mismatched Accept, or an Origin
    // on a plain GET (browsers only attach it to POSTs here, the API being
    // same-origin), is a classic bot tell that trips the WAF.
    const accept = isApi
      ? "*/*"
      : isImage
        ? "image/avif,image/webp,image/apng,image/png,image/svg+xml,*/*;q=0.8"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

    const headers: Record<string, string> = {
      ...request.headers,
      referer: `${domain}/`,
      "user-agent": USER_AGENT,
      accept,
      "accept-language": "en-US,en;q=0.9",
    };
    if (isApi) {
      headers["sec-fetch-site"] = "same-origin";
      headers["sec-fetch-mode"] = "cors";
      headers["sec-fetch-dest"] = "empty";
      if ((request.method ?? "GET").toUpperCase() === "POST") {
        headers.origin = domain;
      }
    }

    return { ...request, headers };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (looksLikeCloudflareChallenge(response, data)) {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: { "user-agent": USER_AGENT },
      });
    }
    return data;
  }
}

/**
 * Call a JSON endpoint under the API base and return its parsed payload.
 * Path segments are appended in order; query values are skipped when
 * undefined; a `body` turns the call into a JSON POST (the search endpoint's
 * transport). A Cloudflare challenge surfaces as a thrown CloudflareError
 * from the interceptor above, so it is never mistaken for a parse failure.
 */
export async function fetchJson<T>(
  segments: (string | number)[],
  query: Record<string, string | number | undefined> = {},
  body?: unknown,
): Promise<T> {
  const builder = new URL(getApiUrl());
  for (const segment of segments) {
    builder.addPathComponent(String(segment));
  }
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    builder.setQueryItem(key, String(value));
  }
  const url = builder.toString();

  const [response, buffer] = await Application.scheduleRequest(
    body === undefined
      ? { url, method: "GET" }
      : {
          url,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (response.status === 404) {
    throw new Error(`Content not found: ${url}`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Request failed with status ${response.status}: ${url}`);
  }

  const text = Application.arrayBufferToUTF8String(buffer);
  try {
    return JSON.parse(text) as T;
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse JSON from ${url}: ${reason}`);
  }
}
