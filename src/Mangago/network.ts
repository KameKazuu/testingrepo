import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";
import { DESKTOP_USER_AGENT, DOMAIN, type MangagoImageContext } from "./models";
import { descrambleMangagoImage } from "./utils";

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

export class MangagoInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        referer: `${DOMAIN}/`,
        origin: DOMAIN,
        cookie: "_m_superu=1",
        "user-agent": request.headers?.["user-agent"] ?? DESKTOP_USER_AGENT,
      },
    };
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
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

export async function fetchText(url: string, headers: Record<string, string> =): Promise<string> {
  const [, data] = await Application.scheduleRequest({
    url,
    method: "GET",
    headers: {
      referer: `${DOMAIN}/`,
      cookie: "_m_superu=1",
      "user-agent": DESKTOP_USER_AGENT,
      ...headers,
    },
  });

  return Application.arrayBufferToUTF8String(data);
}

