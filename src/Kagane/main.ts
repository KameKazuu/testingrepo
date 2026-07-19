/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CloudflareError,
  CookieStorageInterceptor,
  DiscoverSectionType,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { KaganeAdvancedSearchForm } from "./forms/search";
import { getApiUrl, getDataSaver, getDomain, KaganeSettingsForm } from "./forms/settings";
import {
  BOOKS_PATH,
  CHAPTERS_SUBPATH,
  SEARCH_PATH,
  SERIES_PAGE_SIZE,
  SERIES_PATH,
  TAXONOMY_PATHS,
  type BookDto,
  type BookPageDto,
  type GenreDto,
  type Metadata,
  type OptionItem,
  type ReaderDto,
  type SearchBody,
  type SearchMetadata,
  type SeriesDto,
  type SeriesPageDto,
} from "./models";
import { fetchJson, KaganeInterceptor } from "./network";
import {
  parseChapterList,
  parseMangaDetails,
  parseReaderPages,
  toLatestItem,
  toSearchResultItem,
  toSimpleItem,
} from "./parsers";
import type KaganeConfig from "./pbconfig";

const SECTION_LATEST = "latest";
const SECTION_BROWSE = "browse";
const SECTION_GENRES = "genres";

// Guards the chapter-pagination loop against a misbehaving paging envelope.
const MAX_CHAPTER_PAGES = 40;
const CHAPTER_PAGE_SIZE = 500;

interface GenreCatalog {
  names: Map<string, string>;
  options: OptionItem[];
}

// Paperback rejects an empty image URL and fails the whole carousel, so drop
// any card that ended up without a cover rather than break the section.
function hasImage(item: DiscoverSectionItem): boolean {
  return "imageUrl" in item && item.imageUrl.length > 0;
}

export class KaganeExtension implements ExtensionImpl<typeof KaganeConfig> {
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 6,
    bufferInterval: 1,
    ignoreImages: true,
  });
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  kaganeInterceptor = new KaganeInterceptor("main");

  // Genre taxonomy is fetched once and reused for details, the genres carousel
  // and the advanced-search filter.
  private genreCatalog: GenreCatalog | undefined;

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.kaganeInterceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new KaganeSettingsForm();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of cookies) {
      if (
        cookie.name.startsWith("cf") ||
        cookie.name.startsWith("_cf") ||
        cookie.name.startsWith("__cf")
      ) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
  }

  // ----------------------------------------------------------------
  // Genre taxonomy
  // ----------------------------------------------------------------

  private async getGenreCatalog(): Promise<GenreCatalog> {
    if (this.genreCatalog) return this.genreCatalog;
    const names = new Map<string, string>();
    const options: OptionItem[] = [];
    let anySucceeded = false;

    // Merge every taxonomy list that answers; series reference both `genres`
    // and `tags` by UUID, so a wider name map only improves tag resolution.
    for (const path of TAXONOMY_PATHS) {
      try {
        const entries = await fetchJson<GenreDto[]>(path.split("/"));
        anySucceeded = true;
        for (const entry of entries) {
          const name = entry.genre_name ?? entry.tag_name ?? entry.name;
          if (!entry.id || !name) continue;
          names.set(entry.id, name);
          // Only genre-taxonomy axes belong in the filter UI, and `format`
          // duplicates the series' own format field.
          const axis = entry.genre_type?.toLowerCase();
          if (axis && axis !== "format") {
            options.push({ id: entry.id, value: name });
          }
        }
      } catch (error) {
        if (error instanceof CloudflareError) throw error;
        // A missing candidate path costs nothing; keep merging the rest.
      }
    }
    options.sort((a, b) => a.value.localeCompare(b.value));

    // Only cache a round where at least one list answered, so a cold start
    // behind a challenge retries next call instead of pinning an empty map.
    if (!anySucceeded) return { names, options };
    this.genreCatalog = { names, options };
    return this.genreCatalog;
  }

  // ----------------------------------------------------------------
  // Discover
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTION_LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTION_BROWSE, title: "Browse", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION_GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTION_GENRES) {
      const { options } = await this.getGenreCatalog();
      const items: DiscoverSectionItem[] = options.map((option) => ({
        type: "genresCarouselItem",
        name: option.value,
        searchQuery: {
          title: "",
          metadata: { genres: [option.id] } satisfies SearchMetadata,
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const apiUrl = getApiUrl();
    const page = metadata?.page ?? 0;
    // The browse feed is the search endpoint with an empty filter body
    // (POST search/series?page=&size=, newest-first — captured transport).
    const response = await fetchJson<SeriesPageDto>(
      SEARCH_PATH.split("/"),
      { page, size: SERIES_PAGE_SIZE },
      {} satisfies SearchBody,
    );
    const series = response.content ?? [];

    let items =
      section.id === SECTION_LATEST
        ? series.map((s) => toLatestItem(s, apiUrl)).filter(hasImage)
        : series.map((s) => toSimpleItem(s, apiUrl)).filter(hasImage);

    // The chapterUpdates carousel decodes every item as a ChapterUpdatesItem,
    // so an entry without a chapter id would fail the whole array.
    if (section.id === SECTION_LATEST) {
      items = items.filter((item) => item.type === "chapterUpdatesCarouselItem");
    }

    return { items, metadata: this.nextPage(response, series.length, page) };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    const { options } = await this.getGenreCatalog();
    return new KaganeAdvancedSearchForm(query, options);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: Metadata | undefined,
    _sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    // Let readers paste a series link (or the raw series id) into search.
    const pasted = await this.resolveDirectQuery((query.title ?? "").trim());
    if (pasted) return pasted;

    const apiUrl = getApiUrl();
    const page = metadata?.page ?? 0;
    const term = (query.title ?? "").trim();
    const genres = query.metadata?.genres ?? [];

    // Captured transport: POST with the filters as a JSON body (`title` is the
    // confirmed text key; `genres` is the inferred filter key — if genre
    // browsing comes back unfiltered, that body key is what needs correcting).
    const body: SearchBody = {};
    if (term.length > 0) body.title = term;
    if (genres.length > 0) body.genres = genres;

    const response = await fetchJson<SeriesPageDto>(
      SEARCH_PATH.split("/"),
      { page, size: SERIES_PAGE_SIZE },
      body,
    );
    const series = response.content ?? [];

    const items = series
      .map((s) => toSearchResultItem(s, apiUrl))
      .filter((item) => item.imageUrl.length > 0);
    return { items, metadata: this.nextPage(response, series.length, page) };
  }

  // Resolve a pasted `kagane.to/series/<uuid>` URL (or a bare series UUID).
  private async resolveDirectQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let id: string | undefined;
    const urlMatch = query.match(/\/series\/([0-9a-f-]{36})/i);
    if (urlMatch) id = urlMatch[1];
    else if (uuid.test(query)) id = query;
    if (!id) return undefined;

    try {
      const manga = await this.getMangaDetails(id);
      return {
        items: [
          {
            mangaId: manga.mangaId,
            title: manga.mangaInfo.primaryTitle,
            imageUrl: manga.mangaInfo.thumbnailUrl,
            contentRating: manga.mangaInfo.contentRating,
          },
        ],
        metadata: undefined,
      };
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      return undefined;
    }
  }

  // Derive the next-page cursor from the paging envelope, falling back to a
  // full-page heuristic when total_pages isn't returned.
  private nextPage(response: SeriesPageDto, returned: number, page: number): Metadata | undefined {
    if (typeof response.total_pages === "number") {
      return page + 1 < response.total_pages ? { page: page + 1 } : undefined;
    }
    return returned >= SERIES_PAGE_SIZE ? { page: page + 1 } : undefined;
  }

  // ----------------------------------------------------------------
  // Manga details, chapters & pages
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const series = await fetchJson<SeriesDto>([SERIES_PATH, mangaId]);
    if (!series.series_id) throw new Error(`No series data returned for id ${mangaId}.`);
    const { names } = await this.getGenreCatalog();
    return parseMangaDetails(series, getApiUrl(), getDomain(), names);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const books: BookDto[] = [];
    let page = 0;

    while (page < MAX_CHAPTER_PAGES) {
      const response = await fetchJson<BookPageDto | BookDto[]>(
        [SERIES_PATH, sourceManga.mangaId, CHAPTERS_SUBPATH],
        { page, size: CHAPTER_PAGE_SIZE },
      );
      // The endpoint may answer with a bare array (all books) or a paged
      // envelope; handle both and stop once a short/last page arrives.
      if (Array.isArray(response)) {
        books.push(...response);
        break;
      }
      const batch = response.content ?? [];
      books.push(...batch);
      if (batch.length < CHAPTER_PAGE_SIZE) break;
      page++;
    }

    return parseChapterList(books, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const reader = await fetchJson<ReaderDto>([BOOKS_PATH, chapter.chapterId], {
      is_datasaver: getDataSaver() ? "true" : "false",
    });
    if (!reader.access_token || !reader.cache_url) {
      throw new Error(`No reader payload returned for chapter ${chapter.chapterId}.`);
    }
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: parseReaderPages(reader, chapter.chapterId),
    };
  }
}

export const Kagane = new KaganeExtension();
