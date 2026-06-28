import {
  type AdvancedSearchForm,
  BasicRateLimiter,
  CloudflareError,
  CookieStorageInterceptor,
  type Chapter,
  type ChapterDetails,
  type ChapterProviding,
  type CloudflareBypassRequestProviding,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type DiscoverSectionProviding,
  DiscoverSectionType,
  type Extension,
  type Form,
  type MangaProviding,
  type PagedResults,
  type Request,
  type Response,
  type SearchQuery,
  type SearchResultItem,
  type SearchResultsProviding,
  type SettingsFormProviding,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { MangagoAdvancedSearchForm, MangagoSettingsForm } from "./forms";
import {
  DISCOVER_SECTION_OPTIONS,
  DOMAIN,
  GENRE_OPTIONS,
  getDiscoverSectionEnabled,
  getGenreTitle,
  type MangagoSearchMetadata,
} from "./models";
import { MangagoInterceptor, applyMangagoHeaders, fetchText } from "./network";
import {
  chapterUrlFromId,
  hasNextPage,
  mangaUrlFromId,
  parseChapters,
  parseListings,
  parseMangaDetails,
} from "./parsers";
import { getMangagoPageUrls } from "./utils";

type MangagoImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  DiscoverSectionProviding &
  SettingsFormProviding &
  CloudflareBypassRequestProviding;

// The legacy numeric reader (/chapter/<mid>/<cid>/...) 404s on www.mangago.me
// and is windowed even on its mirror, so when a library entry resolves to one we
// first try to upgrade it to the read-manga reader (full image list in one shot)
// and otherwise fetch+walk it on the mirror. Used to detect those entries.
function isNumericChapterReaderUrl(url: string): boolean {
  try {
    return /^\/chapter\/\d+\/\d+/.test(new URL(url, DOMAIN).pathname);
  } catch {
    return false;
  }
}

// These genre tops add the "Webtoons" tag so they list only manhwa/manhua,
// mirroring mangago.zone's curated, manhwa-heavy "Top" carousels — but sourced
// from mangago.me so the items carry titles.
const MANHWA_TOP_SECTION_IDS = new Set(["top_supernatural", "top_mystery"]);

const DISCOVER_SECTION_ALIASES: Record<string, string> = {
  popular: "popular_manga",
  latest: "new_chapters",
};

function normalizeDiscoverSectionId(sectionId: string): string {
  return DISCOVER_SECTION_ALIASES[sectionId] ?? sectionId;
}

function discoverSectionType(sectionId: string): DiscoverSectionType {
  if (sectionId === "featured_manga") return DiscoverSectionType.featured;
  if (sectionId === "genres") return DiscoverSectionType.genres;
  return DiscoverSectionType.simpleCarousel;
}

// Build the genre-browse/filter URL from advanced-search metadata. Mirrors
// mangago's own form: included genres go in the path segment (comma-joined,
// "all" when none), excluded genres in `e`, and the status toggles map 1:1 to
// `f` (Completed) and `o` (Ongoing). e.g. /genre/Yaoi,Romance/1/?e=Smut&f=1&o=1
//
// mangago matches genres by their display title in the URL ("Shounen Ai", not
// the "shounen_ai" id our form stores), so map each id back to its title and
// URL-encode it (spaces become %20). Metadata/tile fields stay id-keyed; only
// this fetched URL string uses the title. Matches the working test-extension.
function buildGenreFilterUrl(
  metadata: MangagoSearchMetadata | undefined,
  page: number,
  sortby: string,
): string {
  const genres = metadata?.genres ?? {};
  const included = Object.entries(genres)
    .filter(([, state]) => state === "included")
    .map(([id]) => encodeURIComponent(getGenreTitle(id)));
  const excluded = Object.entries(genres)
    .filter(([, state]) => state === "excluded")
    .map(([id]) => encodeURIComponent(getGenreTitle(id)));

  // `statuses` is omitted by the form when both are selected (= show all).
  const statuses = metadata?.statuses;
  const completed = !statuses || statuses.includes("f") ? 1 : 0;
  const ongoing = !statuses || statuses.includes("o") ? 1 : 0;

  const pathGenres = included.length > 0 ? included.join(",") : "all";

  const params: string[] = [];
  if (excluded.length > 0) params.push(`e=${excluded.join(",")}`);
  params.push(`f=${completed}`, `o=${ongoing}`);
  if (sortby) params.push(`sortby=${encodeURIComponent(sortby)}`);

  return `${DOMAIN}/genre/${pathGenres}/${page}/?${params.join("&")}`;
}

function discoverItemLimit(sectionId: string): number | undefined {
  // Sections named "Top N" stay capped to that N by design.
  if (sectionId === "top_mystery") return 10;
  if (sectionId.startsWith("top_")) return 5;

  // Everything else (Featured, New Chapters, Popular, Week's/Month's Top)
  // returns the whole page and keeps paginating on scroll instead of being
  // truncated to a 20-item preview. Only one page is fetched up front; further
  // pages load lazily as the user scrolls, so startup cost is unchanged.
  return undefined;
}

function genreSlugFromTopSection(sectionId: string): string {
  return sectionId.replace(/^top_/, "");
}

function buildGenreUrl(domain: string, genre: string, page: number, sortby?: string): string {
  const query = sortby ? `?sortby=${encodeURIComponent(sortby)}` : "";

  return `${domain}/genre/${encodeURIComponent(genre)}/${page}/${query}`;
}

function buildDiscoverUrl(sectionId: string, page: number): string {
  switch (sectionId) {
    case "featured_manga":
      return buildGenreUrl(DOMAIN, "all", page, "view");

    case "new_chapters":
      return buildGenreUrl(DOMAIN, "all", page, "update_date");

    case "popular_manga":
      return buildGenreUrl(DOMAIN, "all", page, "comment_count");

    default:
      if (sectionId.startsWith("top_")) {
        const genre = genreSlugFromTopSection(sectionId);
        if (MANHWA_TOP_SECTION_IDS.has(sectionId)) {
          // mangago's genre filter ANDs comma-joined genres, so "<Genre>,Webtoons"
          // restricts the genre top to manhwa/manhua (like mangago.zone's lists).
          return `${DOMAIN}/genre/${encodeURIComponent(getGenreTitle(genre))},${encodeURIComponent(
            "Webtoons",
          )}/${page}/?f=1&o=1&sortby=view`;
        }
        return buildGenreUrl(DOMAIN, genre, page, "view");
      }

      return buildGenreUrl(DOMAIN, "all", page, "view");
  }
}

function sortingIdToMangagoSort(sortingOption?: SortingOption): string {
  switch (sortingOption?.id) {
    case "views":
      return "view";

    case "popularity":
      return "comment_count";

    case "create_date":
      return "create_date";

    case "update_date":
      return "update_date";

    case "alphabetical":
    default:
      return "";
  }
}

class MangagoExtension implements MangagoImplementation {
  private interceptor = new MangagoInterceptor("mangago-interceptor");

  // Keep a light global limiter for Mangago HTML/API traffic, but do not make
  // the whole source crawl at reader speed. The previous 1 request/second limit
  // serialized discover/search/detail requests and made covers/carousels appear
  // stuck. Reader page walking has its own targeted pacing in utils.ts.
  private rateLimiter = new BasicRateLimiter("mangago-rate-limiter", {
    numberOfRequests: 5,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  async initialise(): Promise<void> {
    // Register the Mangago interceptor LAST. The runtime invokes each registered
    // interceptor with the ORIGINAL request and keeps only the last one's return
    // value, so our header/cookie/UA changes must come from the final interceptor
    // in the chain or they are discarded.
    this.cookieStorageInterceptor.registerInterceptor();
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();

    // Re-apply the desktop UA (+ _m_superu cookie) to redirect TARGETS. The app
    // only runs interceptRequest on the initial request; a redirect followup
    // would otherwise drop our headers. mangago.me canonicalizes numeric
    // /chapter/ URLs by redirecting to the /read-manga/ desktop reader, and we
    // must arrive there as a desktop browser to get the complete page.
    Application.setRedirectHandler(
      Application.Selector(this as MangagoExtension, "handleRedirect"),
    );
  }

  async handleRedirect(request: Request, _response: Response): Promise<Request> {
    return await applyMangagoHeaders(request);
  }

  async saveCloudflareBypassCookies(cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) continue;

      this.cookieStorageInterceptor.setCookie(cookie);
    }
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return [
      {
        id: "alphabetical",
        label: "Alphabetical",
      },
      {
        id: "views",
        label: "Views",
      },
      {
        id: "popularity",
        label: "Popularity",
      },
      {
        id: "create_date",
        label: "Create Date",
      },
      {
        id: "update_date",
        label: "Update Date",
      },
    ];
  }

  async getSettingsForm(): Promise<Form> {
    return new MangagoSettingsForm();
  }

  async getAdvancedSearchForm(
    query: SearchQuery<MangagoSearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    return new MangagoAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<MangagoSearchMetadata>,
    metadata?: MangagoSearchMetadata,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const title = query.title?.trim() ?? "";

    // A text query uses mangago's title search; mangago can't combine free text
    // with the genre filter, so genre/status from the advanced-search form only
    // apply to the no-title browse path (same behaviour as keiyoushi/Aidoku).
    const url = title
      ? `${DOMAIN}/r/l_search?name=${encodeURIComponent(title)}&page=${page}`
      : buildGenreFilterUrl(query.metadata, page, sortingIdToMangagoSort(sortingOption));

    const html = await fetchText(url);
    const items = parseListings(html);

    return {
      items,
      metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTION_OPTIONS.filter((section) => getDiscoverSectionEnabled(section.id)).map(
      (section) => ({
        id: section.id,
        title: section.title,
        type: discoverSectionType(section.id),
      }),
    );
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: MangagoSearchMetadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const sectionId = normalizeDiscoverSectionId(section.id);

    // Genre grid: each tile runs a genre-filtered search when tapped. No fetch
    // needed — the genres are static, so this is a single page of items.
    if (sectionId === "genres") {
      const items: DiscoverSectionItem[] = GENRE_OPTIONS.map((genre) => ({
        type: "genresCarouselItem",
        name: genre.title,
        searchQuery: {
          title: "",
          // `genres` (keyed by genre id) drives getSearchResults; `genre` (the
          // display title) lets the advanced-search form pre-select this genre
          // when opened from the results. Matches the working test-extension.
          metadata: { genre: genre.title, genres: { [genre.id]: "included" } },
        },
      }));

      return { items, metadata: undefined };
    }

    const page = metadata?.page ?? 1;
    const url = buildDiscoverUrl(sectionId, page);

    const html = await fetchText(url);
    const limit = discoverItemLimit(sectionId);

    // slice(0, undefined) returns the whole list, so uncapped sections keep
    // every item on the page.
    const searchItems = parseListings(html).slice(0, limit);

    const items: DiscoverSectionItem[] = searchItems.map((item) => {
      if (discoverSectionType(sectionId) === DiscoverSectionType.featured) {
        return {
          type: "featuredCarouselItem",
          mangaId: item.mangaId,
          title: item.title,
          imageUrl: item.imageUrl,
          metadata: undefined,
        };
      }

      return {
        type: "simpleCarouselItem",
        mangaId: item.mangaId,
        title: item.title,
        imageUrl: item.imageUrl,
        metadata: undefined,
      };
    });

    // Uncapped sections paginate: hand back the next page cursor whenever the
    // fetched page advertises a next page. Capped "Top N" sections and the
    // single-page zone homepage carousels (no pager) stop after one page.
    return {
      items,
      metadata:
        limit === undefined && hasNextPage(html) ? { ...metadata, page: page + 1 } : undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const html = await fetchText(mangaUrlFromId(mangaId));

    return parseMangaDetails(html, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const html = await fetchText(mangaUrlFromId(sourceManga.mangaId));

    return parseChapters(html, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const originalChapterUrl = (
      chapter as Chapter & { additionalInfo?: { originalChapterUrl?: string } }
    ).additionalInfo?.originalChapterUrl;
    const initialChapterUrl = originalChapterUrl ?? chapterUrlFromId(chapter.chapterId);

    // Self-heal stale numeric chapter IDs. www.mangago.me only serves the
    // read-manga reader and 404s the legacy numeric /chapter/<mid>/<cid>/ reader,
    // so a library entry saved before the read-manga switch (numeric ID) would
    // 404 forever. Re-resolve it to the read-manga URL by matching this chapter
    // in the manga's freshly parsed chapter list. New entries are already
    // read-manga and skip this entirely.
    let chapterUrl = initialChapterUrl;
    if (isNumericChapterReaderUrl(chapterUrl)) {
      const resolved = await this.resolveReadMangaChapterUrl(chapter);
      if (resolved) chapterUrl = resolved;
    }

    // Walk a reader URL but swallow non-Cloudflare failures so we can fall back
    // to another candidate. A Cloudflare challenge still propagates so the app
    // opens the bypass flow.
    const softWalk = async (url: string): Promise<string[]> => {
      try {
        return await getMangagoPageUrls(url);
      } catch (error) {
        if (error instanceof CloudflareError) throw error;
        return [];
      }
    };

    let pages: string[];
    if (chapterUrl !== initialChapterUrl) {
      // We upgraded to the read-manga reader. Try it, but if it yields nothing,
      // fall back to walking the ORIGINAL numeric reader directly — that path
      // reliably returns at least page 1's images from the mirror hosts, so a
      // chapter still opens instead of failing outright (the pre-upgrade
      // behavior). The fallback is a hard walk so a real error (e.g. Cloudflare)
      // still surfaces to the app rather than showing an empty reader.
      pages = await softWalk(chapterUrl);
      if (pages.length === 0) {
        pages = await getMangagoPageUrls(initialChapterUrl);
      }
    } else {
      pages = await getMangagoPageUrls(chapterUrl);
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  // Upgrade a numeric chapter entry to its read-manga reader URL. The chapter
  // list rotates between the read-manga catalog (the reader we want: the full
  // image list in one shot) and the numeric catalog (windowed, mirror-only), so
  // retry a few times until we land on the read-manga catalog, then match this
  // chapter in it (by number + title + version). A cache-busting query param on
  // retries avoids any intermediate cache pinning us to the same catalog. If
  // every retry returns the numeric catalog, give up and let getChapterDetails
  // fall back to walking the numeric reader on its mirror.
  private async resolveReadMangaChapterUrl(chapter: Chapter): Promise<string | undefined> {
    const urlOf = (c: Chapter): string =>
      (c as Chapter & { additionalInfo?: { originalChapterUrl?: string } }).additionalInfo
        ?.originalChapterUrl ?? chapterUrlFromId(c.chapterId);

    const mangaUrl = mangaUrlFromId(chapter.sourceManga.mangaId);
    const MAX_RETRIES = 4;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const bust =
          attempt === 0 ? "" : `${mangaUrl.includes("?") ? "&" : "?"}_=${Date.now()}${attempt}`;
        const html = await fetchText(`${mangaUrl}${bust}`);
        const fresh = parseChapters(html, chapter.sourceManga).filter(
          (c) => !isNumericChapterReaderUrl(urlOf(c)),
        );

        // Numeric catalog this round — retry for the read-manga variant.
        if (fresh.length === 0) continue;

        // Match version (uploader/scanlation group) first so a stale entry for a
        // non-first upload doesn't get rewritten to another group's chapter.
        const match =
          fresh.find(
            (c) =>
              c.chapNum === chapter.chapNum &&
              c.title === chapter.title &&
              c.version === chapter.version,
          ) ??
          fresh.find((c) => c.chapNum === chapter.chapNum && c.title === chapter.title) ??
          fresh.find((c) => c.chapNum === chapter.chapNum);

        return match ? urlOf(match) : undefined;
      } catch (error) {
        // Let a Cloudflare challenge propagate so the app opens the bypass flow
        // instead of silently falling through to the known-bad numeric reader.
        if (error instanceof CloudflareError) throw error;
        return undefined;
      }
    }

    return undefined;
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of this.cookieStorageInterceptor.cookies) {
      this.cookieStorageInterceptor.deleteCookie(cookie);
    }

    for (const cookie of cookies) {
      if (cookie.expires && cookie.expires.getTime() <= Date.now()) {
        continue;
      }

      this.cookieStorageInterceptor.setCookie(cookie);
    }
  }
}

export const Mangago = new MangagoExtension();
