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
    // Falls back to the hardcoded desktop UA if the API isn't available.
    //
    // NOTE: We intentionally do NOT downgrade underscore image hosts
    // (e.g. iweb_4.mangapicgallery.com) from HTTPS to HTTP here. That
    // workaround is Android-only (keiyoushi); on iOS, App Transport Security
    // blocks plaintext HTTP, so the image never returns and the reader spins
    // forever ("infinite loading" / partial chapters). Keeping every request
    // on HTTPS is what makes scrambled images load reliably in the iOS app.
    const ua =
      request.headers?.["user-agent"] ??
      (await Application.getDefaultUserAgent().catch(() => DESKTOP_USER_AGENT));

    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        origin: DOMAIN,
        "user-agent": ua,
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

// A hung mirror never throws — scheduleRequest just never resolves — so the
// reader's fallback chain (try the next mirror) would stall forever waiting on
// it. Racing each fetch against a timer turns a hang into a rejection so the
// caller can move on. We can't cancel the underlying request, but we stop
// awaiting it, which is all the walk needs.
const FETCH_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[Mangago] ${label} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export async function fetchText(
  url: string,
  headers: { [key: string]: string } = {},
): Promise<string> {
  const [, data] = await withTimeout(
    Application.scheduleRequest({
      url,
      method: "GET",
      headers: {
        referer: `${DOMAIN}/`,
        "user-agent": DESKTOP_USER_AGENT,
        ...headers,
      },
    }),
    FETCH_TIMEOUT_MS,
    `fetch ${url}`,
  );

  return Application.arrayBufferToUTF8String(data);
}
