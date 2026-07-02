/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  ContentRating,
  CookieStorageInterceptor,
  DiscoverSectionType,
  URL,
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
import type { CheerioAPI } from "cheerio";

import { KingOfShojoSearchForm } from "./forms/search";
import { getBaseUrlOverride, KingOfShojoSettingsForm } from "./forms/settings";
import {
  CARD_SELECTOR,
  DEFAULT_DOMAIN,
  MANGA_DIR,
  NEXT_PAGE_SELECTOR,
  ORDER_OPTIONS,
  type OptionItem,
  type PageMetadata,
  type SearchMetadata,
} from "./models";
import { fetchCheerio, KingOfShojoInterceptor } from "./network";
import {
  hasNextPage,
  parseCards,
  parseChapterPages,
  parseChapters,
  parseGenreFilter,
  parseLatestUpdate,
  parseMangaDetails,
  parsePopularSeries,
  parsePopularToday,
  parseRecommendation,
} from "./parsers";
import type KingOfShojoConfig from "./pbconfig";

const SORTING_OPTIONS: SortingOption[] = ORDER_OPTIONS.map((option) => ({
  id: option.id,
  label: option.value,
}));

const MAX_SEARCH_PAGES = 5;
const HOMEPAGE_TTL = 60 * 1000;
const GENRES_TTL = 60 * 60 * 1000;

export class KingOfShojoExtension implements ExtensionImpl<typeof KingOfShojoConfig> {
  globalRateLimiter = new BasicRateLimiter("rateLimiter", {
    numberOfRequests: 5,
    bufferInterval: 4,
    ignoreImages: true,
  });
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  mainInterceptor = new KingOfShojoInterceptor("main", () => this.baseUrl);

  private homepageCache: { $: CheerioAPI; timestamp: number } | null = null;
  private genresCache: { options: OptionItem[]; timestamp: number } | null = null;

  get baseUrl(): string {
    return getBaseUrlOverride() ?? DEFAULT_DOMAIN;
  }

  get contentRating(): ContentRating {
    return ContentRating.MATURE;
  }

  async initialise(): Promise<void> {
    this.globalRateLimiter.registerInterceptor();
    this.cookieStorageInterceptor.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new KingOfShojoSettingsForm(DEFAULT_DOMAIN);
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
  // Discover — scraped from the homepage widgets
  // ----------------------------------------------------------------

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "popular_today", title: "Popular Today", type: DiscoverSectionType.featured },
      { id: "latest_update", title: "Latest Update", type: DiscoverSectionType.chapterUpdates },
      { id: "recommendation", title: "Recommendation", type: DiscoverSectionType.simpleCarousel },
      {
        id: "popular_series",
        title: "Popular Series",
        type: DiscoverSectionType.prominentCarousel,
      },
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata: PageMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const rating = this.contentRating;

    if (section.id === "genres") {
      const genres = await this.getGenres();
      const items: DiscoverSectionItem[] = genres
        .filter((genre) => genre.id)
        .map((genre) => ({
          type: "genresCarouselItem",
          name: genre.value,
          searchQuery: {
            title: "",
            metadata: { genres: { [genre.id]: "included" } } satisfies SearchMetadata,
          },
          metadata: undefined,
        }));
      return { items, metadata: undefined };
    }

    const $ = await this.getHomepage();
    let items: DiscoverSectionItem[] = [];

    switch (section.id) {
      case "popular_today":
        items = parsePopularToday($, this.baseUrl).map((card) => ({
          type: "featuredCarouselItem",
          mangaId: card.mangaId,
          title: card.title,
          imageUrl: card.imageUrl,
          supertitle: card.subtitle,
          contentRating: rating,
        }));
        break;
      case "recommendation":
        items = parseRecommendation($, this.baseUrl).map((card) => ({
          type: "simpleCarouselItem",
          mangaId: card.mangaId,
          title: card.title,
          imageUrl: card.imageUrl,
          subtitle: card.subtitle,
          contentRating: rating,
        }));
        break;
      case "popular_series":
        items = parsePopularSeries($, this.baseUrl).map((card) => ({
          type: "prominentCarouselItem",
          mangaId: card.mangaId,
          title: card.title,
          imageUrl: card.imageUrl,
          subtitle: card.subtitle,
          contentRating: rating,
        }));
        break;
      case "latest_update":
        items = parseLatestUpdate($, this.baseUrl)
          .filter((card) => card.chapterId)
          .map((card) => ({
            type: "chapterUpdatesCarouselItem",
            mangaId: card.mangaId,
            chapterId: card.chapterId!,
            title: card.title,
            imageUrl: card.imageUrl,
            subtitle: card.chapterName,
            publishDate: card.publishDate,
            contentRating: rating,
          }));
        break;
    }

    return { items, metadata: undefined };
  }

  // ----------------------------------------------------------------
  // Search
  // ----------------------------------------------------------------

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchMetadata>): Promise<AdvancedSearchForm> {
    return new KingOfShojoSearchForm(query, await this.getGenres());
  }

  async getSearchResults(
    query: SearchQuery<SearchMetadata>,
    metadata: PageMetadata | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const title = (query.title || "").trim();

    // Let users paste a manga link into search to open it directly.
    const pasted = await this.resolveUrlQuery(title);
    if (pasted) return pasted;

    const page = metadata?.page ?? 1;
    const meta = query.metadata;
    const order = sortingOption?.id || meta?.orderBy?.[0] || "";

    const builder = new URL(this.baseUrl)
      .addPathComponent(MANGA_DIR)
      .setQueryItem("title", title)
      .setQueryItem("page", page.toString());
    if (order) builder.setQueryItem("order", order);
    if (meta?.author) builder.setQueryItem("author", meta.author);
    if (meta?.year) builder.setQueryItem("yearx", meta.year);
    if (meta?.status?.[0]) builder.setQueryItem("status", meta.status[0]);
    if (meta?.type?.[0]) builder.setQueryItem("type", meta.type[0]);

    const genreValues = Object.entries(meta?.genres ?? {}).map(([slug, state]) =>
      state === "excluded" ? `-${slug}` : slug,
    );
    if (genreValues.length > 0) builder.setQueryItem("genre[]", genreValues);

    const $ = await fetchCheerio({ url: builder.toString(), method: "GET" });
    const items: SearchResultItem[] = parseCards($, this.baseUrl, CARD_SELECTOR).map((card) => ({
      mangaId: card.mangaId,
      title: card.title,
      imageUrl: card.imageUrl,
      subtitle: card.subtitle,
      contentRating: this.contentRating,
    }));

    const nextPage = hasNextPage($, NEXT_PAGE_SELECTOR) && page < MAX_SEARCH_PAGES;
    return { items, metadata: nextPage ? { page: page + 1 } : undefined };
  }

  private async resolveUrlQuery(
    query: string,
  ): Promise<PagedResults<SearchResultItem> | undefined> {
    if (!/^https?:\/\//i.test(query)) return undefined;
    const match = query.match(new RegExp(`/${MANGA_DIR}/([^/?#]+)`, "i"));
    if (!match) return undefined;

    try {
      const manga = await this.getMangaDetails(decodeURIComponent(match[1]));
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
    } catch {
      return undefined;
    }
  }

  // ----------------------------------------------------------------
  // Details, chapters, pages
  // ----------------------------------------------------------------

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const url = this.mangaUrl(mangaId);
    const $ = await fetchCheerio({ url, method: "GET" });
    return parseMangaDetails($, this.baseUrl, mangaId, url, this.contentRating);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const $ = await fetchCheerio({ url: this.mangaUrl(sourceManga.mangaId), method: "GET" });
    return parseChapters($, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = new URL(this.baseUrl).addPathComponent(chapter.chapterId).toString();
    const $ = await fetchCheerio({ url, method: "GET" });
    const pages = parseChapterPages($, this.baseUrl);
    if (pages.length === 0) {
      throw new Error(`No pages found for chapter ${chapter.chapterId}`);
    }
    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private mangaUrl(mangaId: string): string {
    return new URL(this.baseUrl).addPathComponent(MANGA_DIR).addPathComponent(mangaId).toString();
  }

  private async getHomepage(): Promise<CheerioAPI> {
    if (this.homepageCache && Date.now() - this.homepageCache.timestamp < HOMEPAGE_TTL) {
      return this.homepageCache.$;
    }
    const $ = await fetchCheerio({ url: `${this.baseUrl}/`, method: "GET" });
    this.homepageCache = { $, timestamp: Date.now() };
    return $;
  }

  private async getGenres(): Promise<OptionItem[]> {
    if (this.genresCache && Date.now() - this.genresCache.timestamp < GENRES_TTL) {
      return this.genresCache.options;
    }
    try {
      const url = new URL(this.baseUrl).addPathComponent(MANGA_DIR).toString();
      const $ = await fetchCheerio({ url, method: "GET" });
      const options = parseGenreFilter($);
      if (options.length > 0) this.genresCache = { options, timestamp: Date.now() };
      return options;
    } catch {
      return this.genresCache?.options ?? [];
    }
  }
}

export const KingOfShojo = new KingOfShojoExtension();
