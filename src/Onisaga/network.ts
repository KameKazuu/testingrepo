/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN, type PageApiResponse } from "./models";

// Matches a reader page-API url and captures the chapter id, e.g.
// https://onisaga.com/api/chapter/3718181/page/0
const PAGE_API_REGEX = /\/api\/chapter\/([^/]+)\/page\/\d+/;

export class OnisagaInterceptor extends PaperbackInterceptor {
  // Per-chapter reader tokens (chapterId -> X-Reader-Token), populated by
  // getChapterDetails. The token authorizes the page API and is stable for the
  // chapter, so we look it up per request rather than threading it into urls.
  private readerTokens = new Map<string, string>();

  setReaderToken(chapterId: string, token: string): void {
    this.readerTokens.set(chapterId, token);
  }

  override async interceptRequest(request: Request): Promise<Request> {
    const headers: Record<string, string> = {
      ...request.headers,
      referer: `${DOMAIN}/`,
      origin: DOMAIN,
      "user-agent": await Application.getDefaultUserAgent(),
    };

    // A reader page-API request carries the chapter's signed token so the server
    // hands back the page's short-lived image url.
    const cid = PAGE_API_REGEX.exec(request.url)?.[1];
    if (cid) {
      const token = this.readerTokens.get(cid);
      if (token) {
        headers["x-reader-token"] = token;
        headers.accept = "application/json";
        headers["sec-fetch-mode"] = "cors";
        headers["sec-fetch-site"] = "same-origin";
      }
    }

    return { ...request, headers };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
      throw new CloudflareError({
        url: `${DOMAIN}/`,
        method: request.method ?? "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }

    // Lazy page resolution: the reader fetches a page-API url, which returns JSON
    // pointing at the real (signed, short-lived) image. Follow that url here and
    // return the image bytes, so the reader only ever resolves the pages it
    // actually shows instead of the whole chapter up front. The image url is on a
    // different path (/_img/...), so this sub-request doesn't re-enter this branch.
    if (PAGE_API_REGEX.test(request.url) && response.status === 200) {
      try {
        const dto = JSON.parse(Application.arrayBufferToUTF8String(data)) as PageApiResponse;
        if (dto.url) {
          const [, imageBuffer] = await Application.scheduleRequest({
            url: dto.url,
            method: "GET",
            headers: { referer: `${DOMAIN}/` },
          });
          return imageBuffer;
        }
      } catch {
        // Fall through and return the original body; the reader shows a broken
        // page rather than hanging the whole chapter.
      }
    }

    return data;
  }
}

export function livewireHeaders(referer: string): Record<string, string> {
  return {
    "X-Livewire": "",
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/json",
    Origin: DOMAIN,
    Referer: referer,
  };
}
