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
  GENRE_PATH,
  SEARCH_PATH,
  SERIES_PAGE_SIZE,
  SERIES_PATH,
  type GenreDto,
  type Metadata,
  type OptionItem,
  type IntegrityDto,
  type ReaderDto,
  type SearchBody,
  type SearchMetadata,
  type SeriesDetailDto,
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

  // Genre taxonomy for the genres carousel and the advanced-search filter,
  // fetched once per session (details carry their own named genres).
  private genreOptions: OptionItem[] | undefined;

  // Short-lived integrity token the book/reader endpoint requires.
  private integrityToken = "";
  private integrityExp = 0;

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

  private async getGenreOptions(): Promise<OptionItem[]> {
    if (this.genreOptions) return this.genreOptions;
    const options: OptionItem[] = [];

    try {
      const entries = await fetchJson<GenreDto[]>(GENRE_PATH.split("/"));
      for (const entry of entries) {
        const name = entry.genre_name ?? entry.name;
        if (!entry.id || !name) continue;
        // `format` duplicates the series' own format field; keep it out.
        if ((entry.genre_type ?? "genre").toLowerCase() !== "format") {
          options.push({ id: entry.id, value: name });
        }
      }
      options.sort((a, b) => a.value.localeCompare(b.value));
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      // A failed taxonomy fetch just leaves the filter empty; don't cache it so
      // a cold start behind a challenge retries next call.
      return options;
    }

    this.genreOptions = options;
    return this.genreOptions;
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
      const options = await this.getGenreOptions();
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
    const options = await this.getGenreOptions();
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

    // Captured transport: POST with the filters as a JSON body — `title` for
    // text, `genres` as { values, match_all } for the genre filter.
    const body: SearchBody = {};
    if (term.length > 0) body.title = term;
    if (genres.length > 0) body.genres = { values: genres, match_all: true };

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
    const detail = await fetchJson<SeriesDetailDto>([SERIES_PATH, mangaId]);
    if (!detail.series_id) throw new Error(`No series data returned for id ${mangaId}.`);
    return parseMangaDetails(detail, getApiUrl(), getDomain());
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    // The series-detail response carries the full book list under
    // `series_books` — there is no separate chapters endpoint.
    const detail = await fetchJson<SeriesDetailDto>([SERIES_PATH, sourceManga.mangaId]);
    return parseChapterList(detail.series_books ?? [], sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const dataSaver = getDataSaver();
    // The reader payload is a POST gated by a short-lived integrity token; data
    // saver rides as a query param and again as a segment on each image URL.
    // On a 401 the token has lapsed — refresh once and retry.
    let reader: ReaderDto;
    try {
      reader = await this.fetchReader(chapter.chapterId, dataSaver);
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      this.integrityExp = 0;
      reader = await this.fetchReader(chapter.chapterId, dataSaver);
    }
    if (!reader.access_token || !reader.cache_url) {
      throw new Error(`No reader payload returned for chapter ${chapter.chapterId}.`);
    }
    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: parseReaderPages(reader, chapter.chapterId, dataSaver),
    };
  }

  private async fetchReader(bookId: string, dataSaver: boolean): Promise<ReaderDto> {
    const token = await this.getIntegrityToken();
    return fetchJson<ReaderDto>(
      [BOOKS_PATH, bookId],
      { is_datasaver: dataSaver ? "true" : "false" },
      {},
      { "x-integrity-token": token },
    );
  }

  // The book endpoint answers 401 "Integrity token is required" without a valid
  // token. It is minted at {domain}/api/integrity (POST, empty body) after a
  // warm-up GET of the homepage, and cached until its `exp`.
  private async getIntegrityToken(): Promise<string> {
    if (this.integrityToken && this.integrityExp > Date.now()) return this.integrityToken;

    const domain = getDomain();
    await Application.scheduleRequest({ url: `${domain}/`, method: "GET" });
    const [response, buffer] = await Application.scheduleRequest({
      url: `${domain}/api/integrity`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "",
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Integrity token request failed with status ${response.status}.`);
    }
    const dto = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as IntegrityDto;
    if (!dto.token) throw new Error("Integrity token response was empty.");
    this.integrityToken = dto.token;
    this.integrityExp = (dto.exp ?? 0) * 1000;
    return this.integrityToken;
  }
}

export const Kagane = new KaganeExtension();
