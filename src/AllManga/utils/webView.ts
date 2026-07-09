/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { CloudflareError, type CookieStorageInterceptor } from "@paperback/types";

import { pageHostOrder, type PagesData } from "../models";

// Captures the chapterPages payload the reader page fetches from the allanime
// API. The site signs that request with a rotating key we can't reproduce, so
// we let its own JS make the call inside a WebView and grab the decoded JSON.
//
// Three nets, because we can't see the (obfuscated, lazily-loaded) response
// handler and don't know whether it parses via the global JSON.parse or a
// native Response.json(): (1) a JSON.parse proxy, (2) a fetch wrapper, (3) an
// XHR wrapper. All funnel into consider(), gated on the "chapterPages" marker.
// The console breadcrumbs are surfaced by captureConsoleLog so a device run
// tells us *why* a capture fails (never booted vs. fetch CORS-rejected vs.
// parsed-but-unmatched) instead of a bare timeout.
const BOOTSTRAP = `
  (function () {
    var doneResolve, settled = false;
    window.__allMangaResult__ = new Promise(function (r) { doneResolve = r; });
    function finish(value) { if (settled) return; settled = true; doneResolve(value); }
    function consider(text) {
      try {
        if (typeof text === "string" && text.indexOf("chapterPages") !== -1) {
          console.log("[AM] captured chapterPages (" + text.length + " bytes)");
          finish(text);
        }
      } catch (e) {}
    }
    var isApi = function (u) { return typeof u === "string" && u.indexOf("allanime.day") !== -1; };

    var origParse = JSON.parse;
    JSON.parse = new Proxy(origParse, {
      apply: function (target, thisArg, args) {
        var parsed = Reflect.apply(target, thisArg, args);
        try {
          if (parsed && (parsed.chapterPages || (parsed.data && parsed.data.chapterPages))) {
            consider(args[0]);
          }
        } catch (e) {}
        return parsed;
      },
    });

    if (window.fetch) {
      var origFetch = window.fetch;
      window.fetch = function () {
        var url = "";
        try { url = (arguments[0] && arguments[0].url) || String(arguments[0] || ""); } catch (e) {}
        var api = isApi(url);
        if (api) console.log("[AM] fetch -> " + url.slice(0, 140));
        return origFetch.apply(this, arguments).then(function (resp) {
          if (api) {
            try {
              resp.clone().text().then(consider).catch(function (e) {
                console.log("[AM] fetch body read failed: " + e);
              });
            } catch (e) { console.log("[AM] fetch clone failed: " + e); }
          }
          return resp;
        }, function (err) {
          if (api) console.log("[AM] fetch REJECTED (CORS/network?): " + err);
          throw err;
        });
      };
    }

    try {
      var xOpen = XMLHttpRequest.prototype.open, xSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m, u) { this.__amUrl = u; return xOpen.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function () {
        var self = this;
        if (isApi(String(self.__amUrl || ""))) {
          console.log("[AM] xhr -> " + String(self.__amUrl).slice(0, 140));
          self.addEventListener("load", function () { try { consider(self.responseText); } catch (e) {} });
          self.addEventListener("error", function () { console.log("[AM] xhr error: " + String(self.__amUrl).slice(0, 140)); });
        }
        return xSend.apply(this, arguments);
      };
    } catch (e) {}

    console.log("[AM] bootstrap installed; waiting for chapterPages");
    setTimeout(function () { console.log("[AM] timeout (25s), no chapterPages captured"); finish(""); }, 25000);
  })();
`;

export async function pageListViaWebView(
  mangaId: string,
  chapterNum: string,
  cookieInterceptor: CookieStorageInterceptor,
): Promise<PagesData | undefined> {
  const userAgent = await Application.getDefaultUserAgent();

  // Try the preferred mirror first, then the fallback. allmanga.to is served
  // 200 with no Cloudflare and boots via classic <script> tags, so it's the
  // sane default; mkissa.to sits behind an interactive Cloudflare challenge and
  // is a SvelteKit app whose dynamic imports may not run under loadHTMLString.
  //
  // Only surface a Cloudflare challenge for the *preferred* host (i === 0): a
  // challenge on the fallback mirror isn't worth interrupting the reader with a
  // bypass sheet for a host that likely can't serve pages anyway.
  let challenge: CloudflareError | undefined;
  const order = pageHostOrder();
  for (let i = 0; i < order.length; i++) {
    try {
      const pages = await captureFromHost(
        order[i]!,
        mangaId,
        chapterNum,
        cookieInterceptor,
        userAgent,
      );
      if (pages) return pages;
    } catch (error) {
      if (error instanceof CloudflareError) {
        if (i === 0) challenge = error;
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
  const html = Application.arrayBufferToUTF8String(buffer);

  const raw = await Application.executeInWebView({
    source: {
      html: injectBootstrap(html),
      baseUrl: readerUrl,
      loadCSS: false,
      loadImages: false,
      userAgent,
    },
    inject: `return window.__allMangaResult__`,
    storage: { cookies },
    captureConsoleLog: true,
  });

  if (typeof raw.result !== "string" || raw.result.length === 0) {
    return undefined;
  }

  return parseWebViewPayload(raw.result);
}

// Insert the capture bootstrap right after <head> as a raw string. cheerio's
// load()/html() round-trip re-serialises the SPA's inline boot config (Nuxt's
// window.__NUXT__=(...)("/") IIFE), which the app's hydration is sensitive to;
// a plain string splice leaves the document byte-identical otherwise.
function injectBootstrap(html: string): string {
  const tag = `<script>${BOOTSTRAP}</script>`;
  const head = html.match(/<head[^>]*>/i);
  if (head?.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + tag + html.slice(at);
  }
  return tag + html;
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
