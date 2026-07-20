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
  type FeaturedCarouselItem,
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
  TOP_SERIES_CHIPS,
  type Metadata,
  type SearchMetadata,
} from "./models";
import { fetchHtml, OMangaInterceptor } from "./network";
import {
  contentRatingForGenres,
  parseCatalogItems,
  parseChapterDetails,
  parseChapters,
  parseFeaturedDetail,
  parseHomeUpdates,
  parseMangaDetails,
  toProminentItem,
  toSearchResultItem,
  toSimpleItem,
  type FeaturedDetail,
} from "./parsers";
import type OMangaConfig from "./pbconfig";

// Rating/author/summary only exist on detail pages, so the hero is capped and
// each per-title lookup is cached to keep this to a few requests.
const FEATURED_HERO_LIMIT = 8;

const SECTION_POPULAR = "popular";
const SECTION_UPDATES = "updates";
const SECTION_POPULAR_WEEK = "popular_week";
const SECTION_TOP_SERIES = "top_series";
const SECTION_NEW_SEASON = "new_season";
const SECTION_MOST_LIKED = "most_liked";
const SECTION_BEST_ONGOING = "best_ongoing";
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

  private featuredInfoCache = new Map<string, FeaturedDetail>();

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

  // Mirrors the site's own front page: hero, Updates feed, Popular This Week,
  // New Season, Most Liked, Best Ongoings, the Top Series country tabs (as
  // tappable chips), and a genre grid.
  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: SECTION_POPULAR, title: "Popular", type: DiscoverSectionType.featured },
      { id: SECTION_UPDATES, title: "Updates", type: DiscoverSectionType.chapterUpdates },
      {
        id: SECTION_POPULAR_WEEK,
        title: "Popular This Week",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: SECTION_TOP_SERIES, title: "Top Series", type: DiscoverSectionType.genres },
      { id: SECTION_NEW_SEASON, title: "New Season", type: DiscoverSectionType.simpleCarousel },
      { id: SECTION_MOST_LIKED, title: "Most Liked", type: DiscoverSectionType.simpleCarousel },
      {
        id: SECTION_BEST_ONGOING,
        title: "Best Ongoings",
        type: DiscoverSectionType.prominentCarousel,
      },
      { id: SECTION_GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === SECTION_TOP_SERIES) {
      const items: DiscoverSectionItem[] = TOP_SERIES_CHIPS.map((chip) => ({
        type: "genresCarouselItem",
        name: chip.title,
        searchQuery: {
          title: "",
          metadata: { types: [chip.type], sort: "rating" } satisfies SearchMetadata,
        },
        metadata: undefined,
      }));
      return { items, metadata: undefined };
    }

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

    // The Updates feed comes off the front page itself, chapter numbers and
    // release times included — one fetch, one page.
    if (section.id === SECTION_UPDATES) {
      return { items: parseHomeUpdates(await fetchHtml(`${DOMAIN}/`)), metadata: undefined };
    }

    // The remaining rows are catalog queries — the same feeds the site's own
    // "More" arrows point at, so each row paginates on scroll.
    const query: CatalogQuery =
      section.id === SECTION_BEST_ONGOING
        ? { sort: "rating", order: "desc", status: "Ongoing" }
        : {
            sort:
              section.id === SECTION_POPULAR_WEEK
                ? "by_views"
                : section.id === SECTION_NEW_SEASON
                  ? "by_date"
                  : section.id === SECTION_MOST_LIKED
                    ? "votes"
                    : "real_views",
            order: "desc",
          };

    const { items, nextMetadata } = await this.fetchCatalogPage(query, metadata);

    // The hero shows author, description, and year/status pills — fields only
    // the detail pages carry — so its top entries get enriched (and cached).
    if (section.id === SECTION_POPULAR) {
      const heroItems = await Promise.all(
        items
          .filter((item) => item.poster.length > 0)
          .slice(0, FEATURED_HERO_LIMIT)
          .map(async (item): Promise<DiscoverSectionItem> => {
            const info = await this.getFeaturedInfo(item.slug);
            const pills: { symbol: string; text: string }[] = [];
            if (info.year) pills.push({ symbol: "calendar", text: info.year });
            if (info.status) pills.push({ symbol: "book.fill", text: info.status });

            return {
              type: "featuredCarouselItem",
              mangaId: item.slug,
              title: item.title,
              imageUrl: item.poster,
              supertitle: info.author ?? item.type ?? "",
              summary: info.description ?? (item.genres ?? []).slice(0, 4).join(" · "),
              infoItems: pills.length
                ? (pills.slice(0, 2) as FeaturedCarouselItem["infoItems"])
                : undefined,
              contentRating: contentRatingForGenres(item.genres),
              metadata: undefined,
            };
          }),
      );
      return { items: heroItems, metadata: undefined };
    }

    const toItem = section.id === SECTION_BEST_ONGOING ? toProminentItem : toSimpleItem;

    return {
      items: items.map(toItem).filter((item) => "imageUrl" in item && item.imageUrl.length > 0),
      metadata: nextMetadata,
    };
  }

  // Detail-page lookups behind the hero, cached so reopening Discover doesn't
  // refetch; a failed lookup degrades to the plain catalog card.
  private async getFeaturedInfo(slug: string): Promise<FeaturedDetail> {
    const cached = this.featuredInfoCache.get(slug);
    if (cached) return cached;
    try {
      const info = parseFeaturedDetail(await fetchHtml(`${DOMAIN}/manga/${slug}`));
      this.featuredInfoCache.set(slug, info);
      return info;
    } catch {
      return {};
    }
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

    // An explicit sort pick wins; the untouched default ("Popularity") yields
    // to a query's own default sort (the Top Series chips search by rating).
    const picked = SORT_OPTIONS.some((option) => option.id === sortingOption?.id)
      ? (sortingOption?.id as string)
      : "real_views";
    const sortId = picked === "real_views" && meta?.sort ? meta.sort : picked;

    const { items, nextMetadata } = await this.fetchCatalogPage(
      {
        q: title.length > 0 ? title : undefined,
        genre: meta?.genres,
        excludeGenre: meta?.excludeGenres,
        genreStrict: meta?.genreStrict ? "true" : undefined,
        type: meta?.types,
        status: meta?.statuses,
        ageRating: meta?.ageRatings,
        minRating: meta?.minRating,
        year: meta?.year,
        chaptersFrom: meta?.chaptersFrom,
        chaptersTo: meta?.chaptersTo,
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
