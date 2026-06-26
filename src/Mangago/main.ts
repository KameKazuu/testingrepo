import {
  type AdvancedSearchForm,
  BasicRateLimiter,
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
  type SearchQuery,
  type SearchResultItem,
  type SearchResultsProviding,
  type SettingsFormProviding,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { MangagoAdvancedSearchForm, MangagoSettingsForm } from "./forms";
import {
  DISCOVER_DOMAIN,
  DISCOVER_SECTION_OPTIONS,
  DOMAIN,
  GENRE_OPTIONS,
  getDiscoverSectionEnabled,
  getGenreTitle,
  type MangagoSearchMetadata,
} from "./models";
import { MangagoInterceptor, fetchText } from "./network";
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

const DISCOVER_ZONE_SECTION_IDS = new Set([
  "weeks_top",
  "months_top",
  "top_supernatural",
  "top_mystery",
]);

const DISCOVER_SECTION_ALIASES: Record<string, string> = {
  popular: "popular_manga",
  latest: "new_chapters",
};

function normalizeDiscoverSectionId(sectionId: string): string {
  return DISCOVER_SECTION_ALIASES[sectionId] ?? sectionId;
}

function discoverDomainForSection(sectionId: string): string {
  return DISCOVER_ZONE_SECTION_IDS.has(sectionId) ? DISCOVER_DOMAIN : DOMAIN;
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
  if (sectionId === "top_mystery") return 10;
  if (sectionId.startsWith("top_")) return 5;
  if (sectionId === "weeks_top" || sectionId === "months_top") return 10;

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
  const domain = discoverDomainForSection(sectionId);

  switch (sectionId) {
    case "featured_manga":
      return buildGenreUrl(domain, "all", page, "view");

    case "new_chapters":
      return buildGenreUrl(domain, "all", page, "update_date");

    case "popular_manga":
      return buildGenreUrl(domain, "all", page, "comment_count");

    case "weeks_top":
      return buildGenreUrl(domain, "all", page, "week");

    case "months_top":
      return buildGenreUrl(domain, "all", page, "month");

    default:
      if (sectionId.startsWith("top_")) {
        return buildGenreUrl(domain, genreSlugFromTopSection(sectionId), page, "view");
      }

      return buildGenreUrl(domain, "all", page, "view");
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

  private rateLimiter = new BasicRateLimiter("mangago-rate-limiter", {
    numberOfRequests: 5,
    bufferInterval: 1,
    ignoreImages: true,
  });

  private cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });

  async initialise(): Promise<void> {
    this.cookieStorageInterceptor.registerInterceptor();
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
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

    return {
      items,
      metadata: limit === undefined && hasNextPage(html) ? { page: page + 1 } : undefined,
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
    const chapterUrl = chapterUrlFromId(chapter.chapterId);
    const pages = await getMangagoPageUrls(chapterUrl);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
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
