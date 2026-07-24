import {
  BasicRateLimiter,
  PaperbackInterceptor,
  URL,
  type Request,
  type Response,
  type SearchQuery,
  CloudflareError,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { BASE_URL } from "./main";
import {
  getAccountID,
  getIgneous,
  getPassHash,
  getSpoofIP,
  getWarpIP,
  setIgneous,
  type Metadata,
  type SearchMetadata,
} from "./utils";

export const mainRateLimiter = new BasicRateLimiter("main", {
  numberOfRequests: (Application.getState("RateFilter") as number | undefined) ?? 5,
  bufferInterval: 0.5,
  ignoreImages: true,
});
export class MainInterceptor extends PaperbackInterceptor {
  private validImgExtensions = [".jpg", ".jpeg", ".png", ".webp"];

  isImageUrl(url: string): boolean {
    try {
      const pathname = new URL(url).path.toLowerCase();

      return this.validImgExtensions.some((ext) => pathname.endsWith(ext));
    } catch {
      return false;
    }
  }
  override async interceptRequest(request: Request): Promise<Request> {
    if (this.isImageUrl(request.url)) {
      if (request.headers && request.headers["nl-link"]) {
        if (request.headers["first"]) {
          delete request.headers["first"];
          return request;
        } else {
          request.url = request.headers["nl-link"];
          return request;
        }
      }
    } else if (request.url.includes(`${BASE_URL}/g/`)) {
      request.cookies = { nw: "1" };
    } else {
      request.cookies = { sl: "dm_2" };
    }
    request.headers = {
      "user-agent": await Application.getDefaultUserAgent(),
      ...request.headers,
    };
    // ExHentai gates igneous minting by region. Presenting a WARP-range address
    // makes the request look US-originated so the server issues a real igneous
    // instead of the "mystery" placeholder.
    if (request.url.includes("exhentai.org") && getSpoofIP()) {
      request.headers["cf-connecting-ip"] = getWarpIP();
    }
    // Set our cookies last so a stale "igneous=mystery" inherited on the
    // request can't ride along. igneous is our stored real value, or empty
    // when we have none — an empty one forces ExHentai to mint a fresh valid
    // igneous instead of echoing the refused "mystery" forever.
    request.cookies = {
      ...request.cookies,
      ipb_member_id: getAccountID(),
      ipb_pass_hash: getPassHash(),
      igneous: getIgneous(),
    };
    return request;
  }

  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    // Capture a fresh igneous whenever the server sends one. A request carrying
    // the login cookies gets a valid igneous back in Set-Cookie; a "mystery"
    // value means access was refused, so it is never stored.
    const setCookie = response.headers?.["set-cookie"];
    if (setCookie) {
      const match = setCookie.match(/igneous=([^;,\s]+)/);
      if (match && match[1] !== "mystery") setIgneous(match[1]);
    }

    const cfMitigated = response.headers?.["cf-mitigated"];
    if (cfMitigated === "challenge") {
      throw new CloudflareError({
        url: `https://forums.e-hentai.org/`,
        method: request.method ?? "GET",
        headers: {
          "user-agent": await Application.getDefaultUserAgent(),
        },
      });
    }
    return data;
  }
}

export class ImageURLInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return request;
  }
  override async interceptResponse(
    request: Request,
    _response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (!request.url.includes(`${BASE_URL}/s/`)) {
      return data;
    }

    const html = Application.arrayBufferToUTF8String(data);

    const $ = cheerio.load(html);
    const div = $("#i3");
    const image = div.find("img#img");

    const newPage = image.attr("onerror") ?? "";
    const match = newPage.match(/'(\d+-\d+)'/);

    if (match?.[1]) {
      request.headers = {
        "nl-link": `${request.url}?nl=${match[1]}`,
        first: "1",
      };
    }

    request.url = image.attr("src") ?? request.url;

    return (await Application.scheduleRequest(request))[1];
  }
}

// Log in through the forum, which sets ipb_member_id + ipb_pass_hash in its
// Set-Cookie response. Returns true when both were captured into secure state.
export async function loginWithCredentials(username: string, password: string): Promise<boolean> {
  const body =
    `referer=${encodeURIComponent("https://forums.e-hentai.org/")}&b=d&bt=&` +
    `UserName=${encodeURIComponent(username)}&PassWord=${encodeURIComponent(password)}&CookieDate=1`;

  const [response] = await Application.scheduleRequest({
    url: "https://forums.e-hentai.org/index.php?act=Login&CODE=01",
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": await Application.getDefaultUserAgent(),
    },
    body,
  });

  const setCookie = response.headers?.["set-cookie"] ?? "";
  const memberId = setCookie.match(/ipb_member_id=([^;,\s]+)/)?.[1];
  const passHash = setCookie.match(/ipb_pass_hash=([^;,\s]+)/)?.[1];
  if (memberId && passHash) {
    Application.setSecureState(memberId, "ipb_member_id");
    Application.setSecureState(passHash, "ipb_pass_hash");
    return true;
  }
  return false;
}

// Drop any stored igneous and hit ExHentai once so it mints a fresh one. The
// request interceptor attaches the login cookies and region header; the
// response interceptor stores a real igneous when the server returns one.
// Returns true when a usable (non-"mystery") igneous came back.
export async function refreshIgneous(): Promise<boolean> {
  Application.setSecureState(undefined, "igneous");
  const [response] = await Application.scheduleRequest({
    url: "https://exhentai.org/",
    method: "GET",
  });
  const setCookie = response.headers?.["set-cookie"] ?? "";
  const match = setCookie.match(/igneous=([^;,\s]+)/);
  return Boolean(match && match[1] !== "mystery");
}

export class Network {
  buildFilter(query: string, filter: { id: string; value: string[] }) {
    filter.value.forEach((filterValue) => {
      if (filterValue.startsWith("-")) {
        query += ` -${filter.id}:${filterValue.split("-")[1]}`;
      } else {
        if (filter.id === "language" && filter.value.length > 0) {
          if (filterValue.startsWith("-")) {
            query += ` -~${filter.id}:${filterValue.split("-")[1]}`;
          } else {
            query += ` ~${filter.id}:${filterValue}`;
          }
        } else {
          query += ` ${filter.id}:${filterValue}`;
        }
      }
    });
    return query;
  }

  async favoriteRequest(favLink: string) {
    const data = await Application.scheduleRequest({
      url: favLink,
      method: "GET",
    });

    return Application.arrayBufferToUTF8String(data[1]);
  }

  async searchRequest(query: SearchQuery<SearchMetadata>, metadata: Metadata) {
    const url = new URL(BASE_URL);
    const isValid = (n: number) => Number.isFinite(n) && n > 0;
    const typeFilter = query.metadata?.type ?? [];
    const languageFilter = Object.entries(query.metadata?.language ?? {}).map(
      ([k, v]) => `${v === "excluded" ? "-" : ""}${k}`,
    );
    const characterFilter = query.metadata?.character ?? [];
    const femaleFilter = query.metadata?.female ?? [];
    const maleFilter = query.metadata?.male ?? [];
    const artistFilter = query.metadata?.artist ?? [];
    const otherFilter = query.metadata?.other ?? [];
    const mixedFilter = query.metadata?.mixed ?? [];
    const parodyFilter = query.metadata?.parody ?? [];
    const rating = query.metadata?.rating ?? -1;

    if (typeFilter && typeof typeFilter === "object") {
      const ratingSum = typeFilter.reduce((totale, valore) => totale + Number(valore), 0);
      if (ratingSum > 0) {
        url.setQueryItem("f_cats", String(1023 - ratingSum));
      }
    }
    const filterMap = [
      {
        id: "language",
        value: languageFilter,
      },
      {
        id: "character",
        value: characterFilter,
      },
      {
        id: "female",
        value: femaleFilter,
      },
      {
        id: "male",
        value: maleFilter,
      },
      {
        id: "artist",
        value: artistFilter,
      },
      {
        id: "other",
        value: otherFilter,
      },
      {
        id: "mixed",
        value: mixedFilter,
      },
      {
        id: "parody",
        value: parodyFilter,
      },
    ];
    if (rating >= 0) {
      url.setQueryItem("f_srdd", rating.toString());
    }
    filterMap.forEach((filter) => {
      query.title = this.buildFilter(query.title, filter);
    });
    if (query.title) {
      url.setQueryItem("f_search", query.title);
    }
    const min = query.metadata?.minPages ?? 0;
    const max = query.metadata?.maxPages ?? 0;
    if (isValid(min)) url.setQueryItem("f_spf", String(min));
    if (isValid(max)) url.setQueryItem("f_spt", String(max));
    if (metadata?.page) {
      url.setQueryItem("next", metadata.page);
    }

    const data = await Application.scheduleRequest({
      url: url.toString(),
      method: "GET",
    });

    return Application.arrayBufferToUTF8String(data[1]);
  }

  async getSection(popular: boolean) {
    const filterValue = (Application.getState("_type") as string[]) ?? [];
    const ratingSum = filterValue.reduce((acc, val) => acc + Number(val), 0);
    const url = new URL(BASE_URL);
    if (popular) {
      url.setPath("popular");
    }
    url.setQueryItem("f_cats", String(1023 - ratingSum));
    const data = await Application.scheduleRequest({
      url: url.toString(),
      method: "GET",
    });
    return Application.arrayBufferToUTF8String(data[1]);
  }

  async mangaDetailRequest(mangaID: string) {
    const data = await Application.scheduleRequest({
      url: `${BASE_URL}/g/${mangaID}`,
      method: "GET",
    });
    return Application.arrayBufferToUTF8String(data[1]);
  }
  async getChapterPages(url: string) {
    const data = await Application.scheduleRequest({
      url: url,
      method: "GET",
    });
    return Application.arrayBufferToUTF8String(data[1]);
  }
  async getFevList() {
    const data = await Application.scheduleRequest({
      url: `${BASE_URL}/favorites.php`,
      method: "GET",
    });
    const html = Application.arrayBufferToUTF8String(data[1]);
    const $ = cheerio.load(html);
    return $("div.fp")
      .filter((_, el) => $(el).children("div").length === 3) // Skip "Show All Favorites"
      .map((_, el) => {
        const $el = $(el);
        return {
          id: $el.attr("onclick")?.match(/'([^']+)'/)?.[1] ?? "",
          value: $el.children("div").eq(2).text().trim(),
        };
      })
      .get();
  }

  async getFavoriteSelected(mangaid: string) {
    const [gid, t] = mangaid.split("/");
    const page = await Application.scheduleRequest({
      url: `https://e-hentai.org/gallerypopups.php?gid=${gid}&t=${t}&act=addfav`,
      method: "GET",
    });
    const html = Application.arrayBufferToUTF8String(page[1]);
    const $ = cheerio.load(html);
    const favList = $('input[type="radio"][name="favcat"]');
    if (favList.length === 10) {
      return {
        id: "",
        value: "",
      };
    }
    const checked = favList.filter("[checked]");
    if (checked.length) {
      const id = checked.attr("id")!;

      const labelDiv = $(`div[onclick*="${id}"]`)
        .filter((_, el) => $(el).text().trim().length > 0)
        .first();
      return {
        id: id.replace("fav", "https://exhentai.org/favorites.php?favcat="),
        value: labelDiv.text().trim(),
      };
    } else {
      return {
        id: "",
        value: "",
      };
    }
  }
}
