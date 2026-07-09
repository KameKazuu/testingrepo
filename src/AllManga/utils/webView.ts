/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { CloudflareError, type CookieStorageInterceptor } from "@paperback/types";
import * as cheerio from "cheerio";

import { pageHostOrder, type PagesData } from "../models";

// Proxies JSON.parse to capture chapterPages once the reader page decodes it.
const BOOTSTRAP = `
  (function () {
    var doneResolve;
    window.__allMangaResult__ = new Promise(function (r) { doneResolve = r; });
    var settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      doneResolve(value);
    }
    var orig = JSON.parse;
    JSON.parse = new Proxy(orig, {
      apply: function (target, thisArg, args) {
        var parsed = Reflect.apply(target, thisArg, args);
        try {
          if (parsed && (parsed.chapterPages || (parsed.data && parsed.data.chapterPages))) {
            finish(args[0]);
          }
        } catch (e) {}
        return parsed;
      },
    });
    setTimeout(function () { finish(""); }, 25000);
  })();
`;

export async function pageListViaWebView(
  mangaId: string,
  chapterNum: string,
  cookieInterceptor: CookieStorageInterceptor,
): Promise<PagesData | undefined> {
  const userAgent = await Application.getDefaultUserAgent();

  // Load the reader from each mirror in turn (preferred one first) until one
  // yields the payload, so a domain switch (allmanga -> mkissa) resolves without
  // an update. Loading the wrong host returns a redirect stub with no
  // chapterPages, so we just move on.
  //
  // A Cloudflare challenge must NOT be swallowed here: the reader pre-fetch
  // goes through the interceptor, which throws CloudflareError on
  // cf-mitigated. Rethrowing it after the other mirrors also fail lets the
  // app open its bypass webview for the challenged host; once solved, the
  // stored cf_clearance rides into both the pre-fetch and the WebView (same
  // cookies, same default UA the clearance is bound to) and pages resolve.
  let challenge: CloudflareError | undefined;
  for (const host of pageHostOrder()) {
    try {
      const pages = await captureFromHost(host, mangaId, chapterNum, cookieInterceptor, userAgent);
      if (pages) return pages;
    } catch (error) {
      if (error instanceof CloudflareError) {
        challenge = challenge ?? error;
        continue;
      }
      // Network failures on one mirror shouldn't stop the fallback.
    }
  }

  if (challenge) throw challenge;
  return undefined;
}

async function captureFromHost(
  host: string,
  mangaId: string,
  chapterNum: string,
  cookieInterceptor: CookieStorageInterceptor,
  userAgent: string,
): Promise<PagesData | undefined> {
  const readerUrl = `${host}/manga/${mangaId}/chapter-${chapterNum}-sub`;
  const cookies = cookieInterceptor.cookiesForUrl(`${host}/`);

  const [, buffer] = await Application.scheduleRequest({ url: readerUrl, method: "GET" });
  const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
  $("head").prepend(`<script>${BOOTSTRAP}</script>`);

  const raw = await Application.executeInWebView({
    source: { html: $.html(), baseUrl: readerUrl, loadCSS: false, loadImages: false, userAgent },
    inject: `return window.__allMangaResult__`,
    storage: { cookies },
  });

  if (typeof raw.result !== "string" || raw.result.length === 0) {
    return undefined;
  }

  return parseWebViewPayload(raw.result);
}

// chapterPages may be top-level or nested under a GraphQL `data` envelope.
function parseWebViewPayload(payload: string): PagesData | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }

  const root = parsed as { chapterPages?: unknown; data?: { chapterPages?: unknown } };
  const chapterPages = root.chapterPages ?? root.data?.chapterPages;
  if (!chapterPages) return undefined;

  return { chapterPages: chapterPages as PagesData["chapterPages"] };
}
