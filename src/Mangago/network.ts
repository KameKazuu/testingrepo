import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import {
  DOMAIN,
  MANGAGO_SITE_HOSTS,
  READER_USER_AGENT,
  USER_AGENT,
  type MangagoImageContext,
} from "./models";
import { descrambleMangagoImage } from "./utils";

// Remember each image's descramble context (desckey + cols) keyed by its
// clean, fragment-less URL. On a retry the reader sometimes drops the
// "#desckey=...&cols=..." fragment; without this the retried image would come
// back still scrambled. The saved context lets us descramble it anyway.
const IMAGE_CONTEXT_STATE_PREFIX = "mangago-image-context:";
const MANGAGO_SITE_HOST_SET = new Set<string>(MANGAGO_SITE_HOSTS);

function siteOriginFromUrl(url: string): string | undefined {
  const normalized = url.startsWith("//") ? `https:${url}` : url;
  const match = /^(https?:\/\/(?:www\.)?(?:mangago\.me|mangago\.zone|youhim\.me))(?=\/|$)/i.exec(
    normalized,
  );

  return match?.[1];
}

function pathSearchHashFromUrl(url: string): string {
  const normalized = url.startsWith("//") ? `https:${url}` : url;
  const absolute = /^https?:\/\/[^/]+(\/.*)?$/i.exec(normalized);
  if (absolute) return absolute[1] || "/";

  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function pathnameFromUrl(url: string): string {
  const pathSearchHash = pathSearchHashFromUrl(url);
  const delimiter = pathSearchHash.search(/[?#]/);
  return delimiter >= 0 ? pathSearchHash.slice(0, delimiter) : pathSearchHash;
}

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

function isMangagoSiteHost(url: string): boolean {
  const origin = siteOriginFromUrl(url);
  if (!origin) return false;

  return MANGAGO_SITE_HOST_SET.has(origin.replace(/^https?:\/\//i, "").toLowerCase());
}

function originForUrl(url: string): string {
  return siteOriginFromUrl(url) ?? DOMAIN;
}

// A chapter reader page lives at /read-manga/<slug>/<chapter…> (something after
// the slug) or the legacy numeric /chapter/<mid>/<cid>/. The bare
// /read-manga/<slug>/ is the manga-details page, NOT a reader page. Reader pages
// take the desktop UA; everything else (details, listing, search, discover) takes
// the mobile browsing UA so chapter links come back as read-manga URLs.
function isReaderPageUrl(url: string): boolean {
  const pathname = pathnameFromUrl(url);
  const readManga = /^\/read-manga\/[^/]+\/(.+)/.exec(pathname);
  if (readManga && readManga[1].length > 0) return true;
  return /^\/chapter\/\d+\/\d+/.test(pathname);
}

function readerHeadersForUrl(url: string): {
  referer: string;
  origin: string;
  "user-agent": string;
} {
  // read-manga readers are served from www.mangago.me, while legacy numeric
  // readers may be served from alternate hosts (mangago.zone / youhim.me). Match
  // the referer/origin to the requested site host so relative reader links keep
  // working there. The UA is chosen per request type (see USER_AGENT /
  // READER_USER_AGENT in models.ts): reader pages use the desktop UA, everything
  // else the mobile browsing UA.
  const origin = isReaderPageUrl(url) ? originForUrl(url) : DOMAIN;

  return {
    referer: `${origin}/`,
    origin,
    "user-agent": isReaderPageUrl(url) ? READER_USER_AGENT : USER_AGENT,
  };
}

// Apply our headers (page-type UA via readerHeadersForUrl, referer/origin) and
// the _m_superu=1 cookie to Mangago site-host requests. Shared by
// interceptRequest AND the redirect handler so a request keeps these headers
// even after a redirect (the app only runs interceptRequest on the initial
// request).
//
// NOTE: We intentionally do NOT downgrade underscore image hosts
// (e.g. iweb_4.mangapicgallery.com) from HTTPS to HTTP. That workaround is
// Android-only (keiyoushi); on iOS, App Transport Security blocks plaintext
// HTTP, so the image never returns and the reader spins forever. Keeping every
// request on HTTPS is what makes scrambled images load reliably in the iOS app.
//
// The _m_superu=1 flag is merged into request.cookies (NOT overwritten) so it
// sits alongside any Cloudflare-bypass cookies the CookieStorageInterceptor
// injected — the map spread is purely additive. Only the mangago.me host gets it;
// image CDN hosts (cspiclink, mangapicgallery) are excluded because they don't
// need it and must not receive Mangago cookies (that leak previously broke
// hotlinked images).
export async function applyMangagoHeaders(request: Request): Promise<Request> {
  return {
    ...request,
    headers: {
      // URL-based defaults (referer/origin + the per-page-type UA) are the
      // BASELINE; any header explicitly set on the request wins via the spread
      // below. This is deliberate: a reader fetch forces the desktop UA, and we
      // must never let URL-classification downgrade it back to the mobile
      // browsing UA. A stale/prefix-less reader path (e.g. "/uu/<chapter>/pg-N/"
      // left over from an older build) would otherwise miss isReaderPageUrl and
      // get the mobile UA — which makes mangago serve the WINDOWED reader, the
      // very thing that triggers the slow multi-page walk. Honouring the
      // explicit UA keeps every reader fetch on the desktop (full) reader, so
      // page 1 carries the whole chapter in one request (the Aidoku model).
      ...readerHeadersForUrl(request.url),
      ...request.headers,
    },
    cookies: isMangagoSiteHost(request.url)
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
