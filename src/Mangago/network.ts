import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DESKTOP_USER_AGENT, DOMAIN, type MangagoImageContext } from "./models";
import { descrambleMangagoImage } from "./utils";

const IMAGE_CONTEXT_STATE_KEY = "mangago.imageContexts";
const MAX_SAVED_IMAGE_CONTEXTS = 200;

function stripFragment(url: string): string {
  const hashIndex = url.indexOf("#");
  return hashIndex >= 0 ? url.slice(0, hashIndex) : url;
}

function parseImageContext(url: string): MangagoImageContext | null {
  const hashIndex = url.indexOf("#");
  if (hashIndex < 0) return null;

  const fragment = url.slice(hashIndex + 1);
  const params = new URLSearchParams(fragment);

  const desckey = params.get("desckey");
  const colsRaw = params.get("cols");

  if (!desckey || !colsRaw) return null;

  const cols = Number(colsRaw);
  if (!Number.isFinite(cols) || cols <= 0) return null;

  return { desckey, cols };
}

function getSavedImageContexts(): Record<string, MangagoImageContext> {
  const value = Application.getState(IMAGE_CONTEXT_STATE_KEY);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, MangagoImageContext>;
}

function saveImageContext(url: string, context: MangagoImageContext | null): void {
  if (!context) return;

  const saved = getSavedImageContexts();
  const cleanUrl = stripFragment(url);
  const next = {
    ...saved,
    [cleanUrl]: context,
  };

  const keys = Object.keys(next);
  while (keys.length > MAX_SAVED_IMAGE_CONTEXTS) {
    const oldest = keys.shift();
    if (oldest) delete next[oldest];
  }

  Application.setState(next, IMAGE_CONTEXT_STATE_KEY);
}

function readSavedImageContext(url: string): MangagoImageContext | null {
  return getSavedImageContexts()[stripFragment(url)] ?? null;
}

export class MangagoInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    saveImageContext(request.url, parseImageContext(request.url));

    return {
      ...request,
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

    const context = parseImageContext(request.url) ?? readSavedImageContext(request.url);

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
