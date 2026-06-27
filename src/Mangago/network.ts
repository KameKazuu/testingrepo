import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DESKTOP_USER_AGENT, DOMAIN, type MangagoImageContext } from "./models";
import { descrambleMangagoImage } from "./utils";

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

function originForUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return DOMAIN;
  }
}

function isMangagoReaderHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "mangago.me" ||
      host.endsWith(".mangago.me") ||
      host === "mangago.zone" ||
      host.endsWith(".mangago.zone") ||
      host === "youhim.me" ||
      host.endsWith(".youhim.me")
    );
  } catch {
    return false;
  }
}

function readerHeadersForUrl(url: string): {
  referer: string;
  origin: string;
  "user-agent": string;
} {
  // Reader HTML may come from any active Mangago mirror, so preserve that
  // mirror in the headers for Cloudflare/canonical-host compatibility. Image
  // CDN hosts, however, commonly expect the reader site as the referer instead
  // of their own CDN origin, so keep those anchored to the primary Mangago
  // domain.
  const origin = isMangagoReaderHost(url) ? originForUrl(url) : DOMAIN;
  return {
    referer: `${origin}/`,
    origin,
    "user-agent": DESKTOP_USER_AGENT,
  };
}

export class MangagoInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    // NOTE: We intentionally do NOT downgrade underscore image hosts
    // (e.g. iweb_4.mangapicgallery.com) from HTTPS to HTTP here. That
    // workaround is Android-only (keiyoushi); on iOS, App Transport Security
    // blocks plaintext HTTP, so the image never returns and the reader spins
    // forever ("infinite loading" / partial chapters). Keeping every request
    // on HTTPS is what makes scrambled images load reliably in the iOS app.
    //
    // Always send the DESKTOP user-agent — including on image requests. Image
    // GETs are issued by the reader without a UA, so they used to fall through
    // to Application.getDefaultUserAgent(), which on iOS returns the iPhone
    // *mobile* UA. Mangago serves a different (stripped) experience to mobile
    // clients, and aidoku confirmed images should be requested as a desktop
    // browser. Forcing the desktop UA everywhere keeps image and HTML requests
    // consistent.
    return {
      ...request,
      headers: {
        ...request.headers,
        ...readerHeadersForUrl(request.url),
      },
    };
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
  const [, data] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: {
      ...readerHeadersForUrl(url),
      ...headers,
    },
  });

  return Application.arrayBufferToUTF8String(data);
}
