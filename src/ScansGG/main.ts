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

import { ScansGGAdvancedSearchForm } from "./forms/search";
import { getDomain, ScansGGSettingsForm } from "./forms/settings";
import {
  CHAPTER_PAGE_SIZE,
  LATEST_PAGE_SIZE,
  SERIES_PAGE_SIZE,
  TAG_OPTIONS,
  type ChapterDto,
  type Metadata,
  type PageListDto,
  type SearchMetadata,
  type SeriesDto,
} from "./models";
import { fetchApi, ScansGGInterceptor } from "./network";
import {
  numericSeriesId,
  parseChapterDetails,
  parseChapterList,
  parseMangaDetails,
  toFeaturedItem,
  toLatestItem,
  toSearchResultItem,
} from "./parsers";
import type ScansGGConfig from "./pbconfig";
import { pageListViaWebView } from "./utils/webView";

const SECTION_POPULAR = "popular";
const SECTION_LATEST = "latest";
const SECTION_GENRES = "genres";

// Guards the chapter-pagination loop against a misbehaving `has_more` flag.
const MAX_CHAPTER_PAGES = 200;

// Paperback rejects an empty image URL and fails the whole carousel, so drop
// any card that ended up without a cover rather than break the section.
function hasImage(item: DiscoverSectionItem): boolean {
  return "imageUrl" in item && item.imageUrl.length > 0;
}

export class ScansGGExtension implements ExtensionImpl<typeof ScansGGConfig> {
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 2,
    ignoreImages: true,
  });
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  scansGGInterceptor = new ScansGGInterceptor("main");

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.scansGGInterceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new ScansGGSettingsForm();
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
  // Discover
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTION_POPULAR, title: "Popular", type: DiscoverSectionType.featured },
      { id: SECTION_LATEST, title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
      { id: SECTION_GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTION_GENRES) {
      const items: DiscoverSectionItem[] = TAG_OPTIONS.map((tag) => ({
        type: "genresCarouselItem",
        name: tag.value,
        searchQuery: {
          title: "",
          metadata: { tags: [tag.id] } satisfies SearchMetadata,
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const page = metadata?.page ?? 1;

    if (section.id === SECTION_LATEST) {
      const response = await fetchApi<SeriesDto[]>("chapters", {
        page,
        limit: LATEST_PAGE_SIZE,
        chapters: true,
        series_details: true,
        group_details: true,
        sort: "date",
      });
      const items = (response.data ?? []).map(toLatestItem).filter(hasImage);
      return { items, metadata: response.meta?.has_more ? { page: page + 1 } : undefined };
    }

    // Popular — the default `/series` order.
    const response = await fetchApi<SeriesDto[]>("series", {
      limit: SERIES_PAGE_SIZE,
      offset: (page - 1) * SERIES_PAGE_SIZE,
    });
    const items = (response.data ?? []).map(toFeaturedItem).filter(hasImage);
    const hasNext = (response.data ?? []).length === SERIES_PAGE_SIZE;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new ScansGGAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: Metadata | undefined,
    _sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    // Let readers paste a series link (or "id:123") straight into search.
    const pasted = await this.resolveDirectQuery((query.title ?? "").trim());
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const term = (query.title ?? "").trim();
    const meta = query.metadata;

    const response = await fetchApi<SeriesDto[]>("series", {
      limit: SERIES_PAGE_SIZE,
      offset: (page - 1) * SERIES_PAGE_SIZE,
      q: term.length > 0 ? term : undefined,
      q_type: meta?.types ?? [],
      q_status: meta?.statuses ?? [],
      q_tags: meta?.tags ?? [],
    });

    const items = (response.data ?? [])
      .map(toSearchResultItem)
      .filter((item) => item.imageUrl.length > 0);
    const hasNext = (response.data ?? []).length === SERIES_PAGE_SIZE;
    return { items, metadata: hasNext ? { page: page + 1 } : undefined };
  }

  // Resolve a pasted `scans.gg/series/<id>` URL (or `id:<id>`) to a single card.
  private async resolveDirectQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    let id: string | undefined;
    const urlMatch = query.match(/^https?:\/\/[^/]*scans\.gg\/series\/(\d[^/?#]*)/i);
    if (urlMatch) {
      id = decodeURIComponent(urlMatch[1]);
    } else if (/^id:\d+$/i.test(query)) {
      id = query.slice(3).trim();
    }
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

  // ----------------------------------------------------------------
  // Manga details, chapters & pages
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const response = await fetchApi<SeriesDto>("series", {
      id: mangaId,
      trackers: true,
      sources: true,
    });
    if (!response.data) throw new Error(`No series data returned for id ${mangaId}.`);
    return parseMangaDetails(response.data, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const chapters: ChapterDto[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_CHAPTER_PAGES) {
      // The chapters endpoint only accepts the bare numeric series id.
      const response = await fetchApi<ChapterDto[]>("chapters", {
        series_id: numericSeriesId(sourceManga.mangaId),
        limit: CHAPTER_PAGE_SIZE,
        page,
        group_details: true,
      });
      const batch = response.data ?? [];
      chapters.push(...batch);
      hasMore = response.meta?.has_more === true && batch.length > 0;
      page++;
    }

    return parseChapterList(chapters, sourceManga, await this.resolveSlugId(sourceManga));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const storedSeriesId = chapter.additionalInfo?.seriesId ?? chapter.sourceManga.mangaId;
    const groupId = chapter.additionalInfo?.groupId ?? "0";
    // The reader endpoints hang on bare numeric ids; upgrade old stored ids
    // to the slugged form before touching them.
    const seriesId = storedSeriesId.includes("-")
      ? storedSeriesId
      : await this.resolveSlugId(chapter.sourceManga);

    // Primary: the JSON page endpoint (fast once given a slugged series id).
    try {
      const query: Record<string, string> = {
        series_id: seriesId,
        chapter_id: chapter.chapterId,
      };
      if (groupId !== "0") query.group_id = groupId;
      const response = await fetchApi<PageListDto>("chapter-navigation", query);
      if (response.data) return parseChapterDetails(response.data, chapter);
    } catch {
      // Fall through to the WebView scrape below.
    }

    // Fallback: load the reader page in a WebView and scrape the rendered
    // page images, the same way the site itself displays them.
    const readerUrl = `${getDomain()}/series/${seriesId}/${chapter.chapterId}`;
    const pages = await pageListViaWebView(readerUrl, this.cookieStorageInterceptor);
    if (pages.length === 0) {
      throw new Error(`No page data returned for chapter ${chapter.chapterId}.`);
    }
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  // Canonical `{id}-{slug}` series id: from the manga id itself, the stored
  // details, or (for entries saved by older builds) a fresh details fetch.
  private async resolveSlugId(sourceManga: SourceManga): Promise<string> {
    if (sourceManga.mangaId.includes("-")) return sourceManga.mangaId;
    const stored = sourceManga.mangaInfo?.additionalInfo?.slugId;
    if (typeof stored === "string" && stored.includes("-")) return stored;
    try {
      const details = await this.getMangaDetails(sourceManga.mangaId);
      const slugId = details.mangaInfo.additionalInfo?.slugId;
      if (typeof slugId === "string" && slugId.length > 0) return slugId;
    } catch {
      // Fall back to whatever id we already have.
    }
    return sourceManga.mangaId;
  }
}

export const ScansGG = new ScansGGExtension();
