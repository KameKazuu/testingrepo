/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { CloudflareError, type CookieStorageInterceptor } from "@paperback/types";

import { pageHostOrder, type PagesData } from "../models";

// Captures the chapterPages payload the reader page fetches from the allanime
// API by letting the site's own JS make the signed call inside a WebView. The
// response handler is obfuscated and lazily loaded, so watch the three paths it
// might decode through — a JSON.parse proxy, a fetch wrapper and an XHR wrapper
// — and resolve on the first payload carrying the "chapterPages" marker.
const BOOTSTRAP = `
  (function () {
    var doneResolve, settled = false;
    window.__allMangaResult__ = new Promise(function (r) { doneResolve = r; });
    function finish(value) { if (settled) return; settled = true; doneResolve(value); }
    function consider(text) {
      if (typeof text === "string" && text.indexOf("chapterPages") !== -1) finish(text);
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
        return origFetch.apply(this, arguments).then(function (resp) {
          if (api) { try { resp.clone().text().then(consider).catch(function () {}); } catch (e) {} }
          return resp;
        });
      };
    }

    try {
      var xOpen = XMLHttpRequest.prototype.open, xSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (m, u) { this.__amUrl = u; return xOpen.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function () {
        var self = this;
        if (isApi(String(self.__amUrl || ""))) {
          self.addEventListener("load", function () { try { consider(self.responseText); } catch (e) {} });
        }
        return xSend.apply(this, arguments);
      };
    } catch (e) {}

    setTimeout(function () { finish(""); }, 25000);
  })();
`;

export async function pageListViaWebView(
  mangaId: string,
  chapterNum: string,
  title: string,
  cookieInterceptor: CookieStorageInterceptor,
): Promise<PagesData | undefined> {
  const userAgent = await Application.getDefaultUserAgent();
  // The reader is a client-rendered SPA whose router needs the {slug} segment
  // (…/manga/{id}/{slug}/chapter-…) to resolve the chapter and fetch pages; a
  // slug-less URL lands on a non-chapter route and never fetches. Any non-empty
  // slug works — the app keys its data off the id.
  const slug = toSlug(title) || mangaId;

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
        slug,
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
  slug: string,
  cookieInterceptor: CookieStorageInterceptor,
  userAgent: string,
): Promise<PagesData | undefined> {
  const readerUrl = `${host}/manga/${mangaId}/${slug}/chapter-${chapterNum}-sub`;
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
  });

  if (typeof raw.result !== "string" || raw.result.length === 0) {
    return undefined;
  }

  return parseWebViewPayload(raw.result);
}

// A URL-safe slug from the manga title for the reader route's {slug} segment.
function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
