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

// Downgrade HTTPS -> HTTP only when the host contains an underscore (e.g.
// iweb_4.mangapicgallery.com), preserving any path/query/fragment. Mangago's
// main reader hosts never contain underscores, so they're untouched. This is
// the same workaround keiyoushi uses for these image hosts.
function downgradeUnderscoreHost(url: string): string {
  if (!url.startsWith("https://")) return url;

  const afterScheme = url.slice("https://".length);
  const hostEnd = afterScheme.search(/[/?#]/);
  const host = (hostEnd >= 0 ? afterScheme.slice(0, hostEnd) : afterScheme).toLowerCase();

  if (!host.includes("_")) return url;

  return `http://${afterScheme}`;
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
  const params = new URLSearchParams(fragment);

  const desckey = params.get("desckey");
  const colsRaw = params.get("cols");

  if (!desckey || !colsRaw) return readSavedImageContext(url);

  const cols = Number(colsRaw);
  if (!Number.isFinite(cols) || cols <= 0) return readSavedImageContext(url);

  const context = { desckey, cols };
  saveImageContext(url, context);
  return context;
}

export class MangagoInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    // Mangago serves some scrambled images from hosts containing an underscore
    // (e.g. iweb_4.mangapicgallery.com). Those fail to load over HTTPS in some
    // runtimes ("internal error"), so downgrade just those hosts to HTTP — the
    // same workaround keiyoushi uses. Only the host's images are affected.
    const url = downgradeUnderscoreHost(request.url);

    return {
      ...request,
      url,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        origin: DOMAIN,
        "user-agent": request.headers?.["user-agent"] ?? DESKTOP_USER_AGENT,
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
          referer: `${DOMAIN}/`,
          origin: DOMAIN,
          "user-agent": request.headers?.["user-agent"] ?? DESKTOP_USER_AGENT,
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
      referer: `${DOMAIN}/`,
      "user-agent": DESKTOP_USER_AGENT,
      ...headers,
    },
  });

  return Application.arrayBufferToUTF8String(data);
}