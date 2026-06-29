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
import {
  canonicalReaderUrl,
  getMangagoPageUrls,
  isNumericChapterReaderUrl,
  isReadMangaReaderUrl,
} from "./utils";

type MangagoImplementation = Extension &
  SearchResultsProviding &
  MangaProviding &
  ChapterProviding &
  DiscoverSectionProviding &
  SettingsFormProviding &
  CloudflareBypassRequestProviding;

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
        // mangago matches a genre by its display TITLE in the path
        // (/genre/Shounen Ai/), not the underscore slug. getGenreTitle maps the
        // section slug back to the title; without it multi-word tops
        // (top_shounen_ai, top_school_life) request /genre/shounen_ai/ and come
        // back empty.
        return buildGenreUrl(DOMAIN, getGenreTitle(genre), page, "view");
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
    // Register the Mangago interceptor LAST. The runtime chains interceptors
    // (each one's output feeds the next), so registering last lets us read the
    // Cloudflare-bypass cookies the CookieStorageInterceptor injected and merge
    // our headers/cookie/UA on top via the additive spread in applyMangagoHeaders.
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

    // Self-heal stale chapter URLs. A stored URL that is neither a proper
    // /read-manga/<slug>/<chapter> reader page NOR a numeric /chapter/<mid>/<cid>/
    // reader can never load — e.g. a prefix-less "/uu/<chapter>/pg-N/", what
    // canonicalReaderUrl produces when it de-doubles a stale
    // ".../https://www.mangago.me/uu/.../pg-N/" entry whose /read-manga/<slug>/
    // prefix an older build had dropped. Re-resolve it to the real read-manga URL
    // by matching this chapter in the manga's freshly parsed chapter list.
    //
    // Numeric URLs are deliberately NOT re-resolved here: getMangagoPageUrls
    // already tries every mirror host that serves the numeric reader, and many
    // titles only expose numeric links (so there is no read-manga URL to upgrade
    // to). If that mirror sweep fails we fall back to a read-manga upgrade below.
    // Normalise first so the check and the fetch both see the real path.
    let chapterUrl = canonicalReaderUrl(initialChapterUrl);
    if (!isReadMangaReaderUrl(chapterUrl) && !isNumericChapterReaderUrl(chapterUrl)) {
      const resolved = await this.resolveReadMangaChapterUrl(chapter);
      if (resolved) chapterUrl = resolved;
    }

    // Fetch the reader — the read-manga reader (and the full numeric reader)
    // return the COMPLETE image list in one request. A Cloudflare challenge
    // surfaces as the bypass webview; a genuine decode/parse failure surfaces as
    // an error rather than a silently short chapter.
    let pages: string[];
    try {
      pages = await getMangagoPageUrls(chapterUrl);
    } catch (error) {
      // A Cloudflare wall must reach the user as the bypass prompt.
      if (error instanceof CloudflareError) throw error;
      // Last resort for a numeric reader that failed on every mirror host: try
      // upgrading to the read-manga reader via the fresh chapter list (works for
      // titles that DO expose read-manga links). Titles with only numeric mirror
      // links won't match, so the original error is surfaced unchanged.
      if (!isReadMangaReaderUrl(chapterUrl)) {
        const resolved = await this.resolveReadMangaChapterUrl(chapter);
        if (resolved && resolved !== chapterUrl) {
          pages = await getMangagoPageUrls(resolved);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  // Upgrade a stale numeric chapter entry (saved before the read-manga switch)
  // to its read-manga reader URL by re-parsing the manga's current chapter list
  // and matching this chapter in it (by number + title + version). Browsing now
  // uses the mobile UA, so the list comes back as read-manga URLs; the retry +
  // cache-bust is a belt-and-suspenders guard against a momentarily stale list.
  // If no match is found, getChapterDetails fetches the original URL and surfaces
  // a clear error rather than a silently wrong chapter.
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
        const fresh = parseChapters(html, chapter.sourceManga).filter((c) =>
          isReadMangaReaderUrl(urlOf(c)),
        );

        // No read-manga URLs this round (a momentarily stale/numeric catalog) —
        // retry for the read-manga variant.
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
          // Bare chapter-number match, but ONLY when the number is meaningful.
          // chapNum === 0 is the "unnumbered" sentinel (Extra/Oneshot/Side Story/
          // Afterword…), and every unnumbered chapter collides at 0 — matching on
          // the number alone would pick whichever sorts first, opening the wrong
          // chapter. For those, require a title match (the tiers above); if none
          // matches, return undefined so getChapterDetails surfaces a clear error
          // instead of a silently wrong chapter.
          (chapter.chapNum !== 0 ? fresh.find((c) => c.chapNum === chapter.chapNum) : undefined);

        return match ? urlOf(match) : undefined;
      } catch (error) {
        // Let a Cloudflare challenge propagate so the app opens the bypass flow
        // instead of silently falling through to the known-bad numeric reader.
        if (error instanceof CloudflareError) throw error;
        // A transient failure (rate-limit, -999 cancel, momentary network) on one
        // attempt shouldn't abort the whole upgrade — retry the remaining rounds.
        continue;
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
