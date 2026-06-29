import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import {
  DESKTOP_USER_AGENT,
  DOMAIN,
  getChapterListUserAgentMode,
  MOBILE_USER_AGENT,
  READER_MIRROR,
  READER_MIRROR_FALLBACK,
  type MangagoImageContext,
} from "./models";
import { descrambleMangagoImage } from "./utils";

// The manga page / chapter-list URL is `/read-manga/<slug>/` (no chapter/page
// segment). Only this page's UA controls whether the chapter list comes back as
// read-manga or numeric reader URLs; reader pages always use the desktop UA.
function isMangaListingPage(url: string): boolean {
  try {
    const parsed = new URL(url, DOMAIN);
    const host = parsed.hostname.toLowerCase();
    if (host !== "mangago.me" && !host.endsWith(".mangago.me")) return false;
    return /^\/read-manga\/[^/]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

// Remember each image's descramble context (desckey + cols) keyed by its
// clean, fragment-less URL. On a retry the reader sometimes drops the
// "#desckey=...&cols=..." fragment; without this the retried image would come
// back still scrambled. The saved context lets us descramble it anyway.
const IMAGE_CONTEXT_STATE_PREFIX = "mangago-image-context:";

function cleanUrl(url: string): string {
  const hashIndex = url.indexOf("#");
  return hashIndex >= 0 ? url.slice(0, hashIndex) : url;
}

function saveImageContext(url: string, context: MangagoImageContext): void {
  try {
    Application.setState(
      { desckey: context.desckey, cols: context.cols },
      `${IMAGE_CONTEXT_STATE_PREFIX}${cleanUrl(url)}`,
    );
  } catch {
    // State storage is only a safety net; ignore failures.
  }
}

function readSavedImageContext(url: string): MangagoImageContext | null {
  try {
    const raw = Application.getState(`${IMAGE_CONTEXT_STATE_PREFIX}${cleanUrl(url)}`) as
      | { desckey?: unknown; cols?: unknown }
      | undefined;

    const desckey = typeof raw?.desckey === "string" ? raw.desckey : undefined;
    const cols = typeof raw?.cols === "number" ? raw.cols : undefined;

    if (!desckey || !cols || cols <= 0) return null;

    return { desckey, cols };
  } catch {
    return null;
  }
}

function parseImageContext(url: string): MangagoImageContext | null {
  const hashIndex = url.indexOf("#");
  if (hashIndex < 0) return readSavedImageContext(url);

  const fragment = url.slice(hashIndex + 1);

  // Parse the "desckey=...&cols=..." fragment by hand instead of via
  // URLSearchParams: URL is polyfilled on-device but URLSearchParams is not
  // guaranteed, and this fragment is written by annotateImageUrl() with
  // encodeURIComponent, so a split + decodeURIComponent round-trips exactly.
  const fragmentParams = new Map<string, string>();
  for (const pair of fragment.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    try {
      fragmentParams.set(key, decodeURIComponent(value));
    } catch {
      fragmentParams.set(key, value);
    }
  }

  const desckey = fragmentParams.get("desckey");
  const colsRaw = fragmentParams.get("cols");

  if (!desckey || !colsRaw) return readSavedImageContext(url);

  const cols = Number(colsRaw);
  if (!Number.isFinite(cols) || cols <= 0) return readSavedImageContext(url);

  const context = { desckey, cols };
  saveImageContext(url, context);
  return context;
}

function isMangagoHost(url: string): boolean {
  try {
    const host = new URL(url, DOMAIN).hostname.toLowerCase();
    return host === "mangago.me" || host.endsWith(".mangago.me");
  } catch {
    return false;
  }
}

const READER_MIRROR_HOSTS = [READER_MIRROR, READER_MIRROR_FALLBACK]
  .map((mirror) => {
    try {
      return new URL(mirror).hostname.toLowerCase();
    } catch {
      return "";
    }
  })
  .filter(Boolean);

// True for the numeric-reader mirror hosts (mangago.zone / youhim.me). They
// serve the same reader as www.mangago.me and need the same _m_superu=1 flag to
// return the COMPLETE (non-windowed) imgsrcs list — without it, a request the
// backstop reroutes to a mirror would come back sliced and truncate the chapter.
function isReaderMirrorHost(url: string): boolean {
  try {
    const host = new URL(url, DOMAIN).hostname.toLowerCase();
    return READER_MIRROR_HOSTS.includes(host);
  } catch {
    return false;
  }
}

// Hosts that must receive the _m_superu=1 full-reader flag: the main domain and
// the numeric-reader mirrors. Image CDN hosts (cspiclink, mangapicgallery) are
// deliberately excluded — they don't need it and must not receive Mangago
// cookies.
function isMangagoReaderHost(url: string): boolean {
  return isMangagoHost(url) || isReaderMirrorHost(url);
}

function readerHeadersForUrl(url: string): {
  referer: string;
  origin: string;
  "user-agent": string;
} {
  // Use a SAME-ORIGIN referer/origin when fetching a reader mirror
  // (mangago.zone / youhim.me). The mirrors serve a numeric reader's page 1 to
  // anyone, but redirect its SUB-pages (/chapter/<mid>/<cid>/<n>/) to
  // www.mangago.me — which 404s them — when the request's referer/origin is the
  // cross-origin main domain. Sending the mirror's own origin (what a browser on
  // that mirror sends) lets the sub-page load, so the whole chapter walks instead
  // of stopping at the first 5-image window. Everything else (main domain, image
  // CDN hosts) keeps the canonical www.mangago.me referer.
  let base = DOMAIN;
  if (isReaderMirrorHost(url)) {
    try {
      const u = new URL(url, DOMAIN);
      base = `${u.protocol}//${u.host}`;
    } catch {
      // Fall back to the canonical domain.
    }
  }

  // Reader pages always use the desktop UA (it returns the complete reader). Only
  // the manga listing page honours the user's "Chapter List User-Agent" setting:
  // mobile makes mangago hand back read-manga chapter URLs instead of numeric
  // ones, which load fully on www.mangago.me without the windowed-mirror walk.
  const userAgent =
    getChapterListUserAgentMode() === "mobile" && isMangaListingPage(url)
      ? MOBILE_USER_AGENT
      : DESKTOP_USER_AGENT;

  return {
    referer: `${base}/`,
    origin: base,
    "user-agent": userAgent,
  };
}

// Apply our headers (page-type UA via readerHeadersForUrl, referer/origin) and
// the _m_superu=1 cookie to a www.mangago.me request. Shared by interceptRequest
// AND the redirect handler so a request keeps these headers even after a
// redirect (the app only runs interceptRequest on the initial request).
//
// NOTE: We intentionally do NOT downgrade underscore image hosts
// (e.g. iweb_4.mangapicgallery.com) from HTTPS to HTTP. That workaround is
// Android-only (keiyoushi); on iOS, App Transport Security blocks plaintext
// HTTP, so the image never returns and the reader spins forever. Keeping every
// request on HTTPS is what makes scrambled images load reliably in the iOS app.
//
// The _m_superu=1 flag is merged into request.cookies (NOT overwritten) so it
// sits alongside any Cloudflare-bypass cookies the CookieStorageInterceptor
// injected — the map spread is purely additive. Only reader hosts (the main
// domain AND the numeric-reader mirrors) get it; image CDN hosts (cspiclink,
// mangapicgallery) are excluded because they don't need it and must not receive
// Mangago cookies (that leak previously broke hotlinked images).
export async function applyMangagoHeaders(request: Request): Promise<Request> {
  return {
    ...request,
    headers: {
      ...request.headers,
      ...readerHeadersForUrl(request.url),
    },
    cookies: isMangagoReaderHost(request.url)
      ? { ...request.cookies, _m_superu: "1" }
      : request.cookies,
  };
}

export class MangagoInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return applyMangagoHeaders(request);
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
      throw new CloudflareError({
        url: request.url,
        method: request.method ?? "GET",
        headers: {
          ...readerHeadersForUrl(request.url),
        },
      });
    }

    // Only scrambled reader images live on the cspiclink host and need
    // descrambling. Cover thumbnails (mangapicgallery) and every other plain
    // image skip the descramble path — and, importantly, the per-image
    // Application.getState lookup parseImageContext would otherwise do — so they
    // return as fast as the network delivers them.
    if (!request.url.includes("cspiclink")) return data;

    const context = parseImageContext(request.url);

    if (!context) return data;

    try {
      return await descrambleMangagoImage(
        data,
        context.desckey,
        context.cols,
        response.mimeType ?? "image/jpeg",
      );
    } catch (error) {
      console.log(
        `[Mangago] image descramble failed for ${request.url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return data;
    }
  }
}

export async function fetchText(
  url: string,
  headers: { [key: string]: string } = {},
): Promise<string> {
  return (await fetchTextWithUrl(url, headers)).text;
}

// Like fetchText, but also returns the FINAL response URL after redirects.
// mangago.me canonicalizes numeric /chapter/ reader URLs by redirecting to the
// /read-manga/ reader; callers that then walk reader pages must key off this
// final URL, not the original request URL, or same-chapter next_page links on
// the redirected (read-manga) page won't match and the walk stops early.
export async function fetchTextWithUrl(
  url: string,
  headers: { [key: string]: string } = {},
): Promise<{ text: string; finalUrl: string }> {
  const [response, data] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: {
      ...readerHeadersForUrl(url),
      ...headers,
    },
  });

  return {
    text: Application.arrayBufferToUTF8String(data),
    finalUrl: response.url || url,
  };
}
