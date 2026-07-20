/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  CookieStorageInterceptor,
  DiscoverSectionType,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { OMangaAdvancedSearchForm } from "./forms/search";
import {
  CATALOG_PAGE_SIZE,
  DOMAIN,
  GENRE_OPTIONS,
  SORT_OPTIONS,
  type Metadata,
  type SearchMetadata,
} from "./models";
import { fetchHtml, OMangaInterceptor } from "./network";
import {
  contentRatingForGenres,
  parseCatalogItems,
  parseChapterDetails,
  parseChapters,
  parseMangaDetails,
  toFeaturedItem,
  toProminentItem,
  toSearchResultItem,
  toSimpleItem,
} from "./parsers";
import type OMangaConfig from "./pbconfig";

const SECTION_POPULAR = "popular";
const SECTION_UPDATED = "updated";
const SECTION_NEW = "new";
const SECTION_TOP_RATED = "top_rated";
const SECTION_GENRES = "genres";

/** Catalog query values; repeated keys become repeated parameters. */
type CatalogQuery = Record<string, string | string[] | undefined>;

function buildCatalogUrl(query: CatalogQuery): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    for (const single of Array.isArray(value) ? value : [value]) {
      if (single.length === 0) continue;
      parts.push(`${key}=${encodeURIComponent(single)}`);
    }
  }
  return parts.length > 0 ? `${DOMAIN}/catalog?${parts.join("&")}` : `${DOMAIN}/catalog`;
}

export class OMangaExtension implements ExtensionImpl<typeof OMangaConfig> {
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 1,
    ignoreImages: true,
  });

  // Remembers the Cloudflare clearance cookies after a challenge is solved.
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  oMangaInterceptor = new OMangaInterceptor("main");

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.oMangaInterceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.name.startsWith("cf") || cookie.name.startsWith("__cf")) {
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
      { id: SECTION_UPDATED, title: "Recently Updated", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION_NEW, title: "Recently Added", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION_TOP_RATED, title: "Top Rated", type: DiscoverSectionType.prominentCarousel },
      { id: SECTION_GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTION_GENRES) {
      const items: DiscoverSectionItem[] = GENRE_OPTIONS.map((genre) => ({
        type: "genresCarouselItem",
        name: genre.value,
        searchQuery: {
          title: "",
          metadata: { genres: [genre.id] } satisfies SearchMetadata,
        },
        contentRating: contentRatingForGenres([genre.value]),
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

    const sort =
      section.id === SECTION_UPDATED
        ? "updated_at"
        : section.id === SECTION_NEW
          ? "created_at"
          : section.id === SECTION_TOP_RATED
            ? "rating"
            : "real_views";

    const { items, nextMetadata } = await this.fetchCatalogPage({ sort, order: "desc" }, metadata);

    const toItem =
      section.id === SECTION_POPULAR
        ? toFeaturedItem
        : section.id === SECTION_TOP_RATED
          ? toProminentItem
          : toSimpleItem;

    return {
      items: items.map(toItem).filter((item) => "imageUrl" in item && item.imageUrl.length > 0),
      // The hero carousel stays a single curated page; rows paginate on scroll.
      metadata: section.id === SECTION_POPULAR ? undefined : nextMetadata,
    };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSortingOptions(_query: SearchQuery<SearchMetadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS.map((option) => ({ id: option.id, label: option.label }));
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new OMangaAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: Metadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const title = (query.title ?? "").trim();
    const meta = query.metadata;
    const sortId = SORT_OPTIONS.some((option) => option.id === sortingOption?.id)
      ? (sortingOption?.id as string)
      : "real_views";

    const { items, nextMetadata } = await this.fetchCatalogPage(
      {
        q: title.length > 0 ? title : undefined,
        genre: meta?.genres,
        type: meta?.types,
        status: meta?.statuses,
        year: meta?.year,
        tag: meta?.tag,
        sort: sortId,
        order: "desc",
      },
      metadata,
    );

    return {
      items: items.map(toSearchResultItem).filter((item) => item.imageUrl.length > 0),
      metadata: nextMetadata,
    };
  }

  /**
   * Fetch one catalog page and derive the next-page cursor. The first item id
   * of each page rides along in the cursor: if the next page opens with the
   * same id, the server ignored `page` and pagination ends instead of looping.
   */
  private async fetchCatalogPage(query: CatalogQuery, metadata: Metadata | undefined) {
    const page = metadata?.page ?? 1;
    const url = buildCatalogUrl({ ...query, page: page > 1 ? String(page) : undefined });

    const items = parseCatalogItems(await fetchHtml(url));
    const firstId = items[0]?.id;

    if (page > 1 && firstId !== undefined && firstId === metadata?.firstId) {
      return { items: [], nextMetadata: undefined };
    }

    const nextMetadata: Metadata | undefined =
      items.length === CATALOG_PAGE_SIZE ? { page: page + 1, firstId } : undefined;
    return { items, nextMetadata };
  }

  // ----------------------------------------------------------------
  // Manga details, chapters & pages
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const html = await fetchHtml(`${DOMAIN}/manga/${mangaId}`);
    return parseMangaDetails(html, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    // The series page embeds the complete chapter list — one request.
    const html = await fetchHtml(`${DOMAIN}/manga/${sourceManga.mangaId}`);
    return parseChapters(html, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const html = await fetchHtml(
      `${DOMAIN}/manga/${chapter.sourceManga.mangaId}/chapter/${chapter.chapterId}`,
    );
    return parseChapterDetails(html, chapter);
  }
}

export const OManga = new OMangaExtension();
