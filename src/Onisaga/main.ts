/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  ContentRating,
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
import * as cheerio from "cheerio";

import {
  getDiscoverStatus,
  getDiscoverType,
  getExcludedGenres,
  getImageRateLimitMs,
  getShowNsfw,
  OnisagaAdvancedSearchForm,
  OnisagaSettingsForm,
} from "./forms";
import {
  buildBrowseRequest,
  buildLoadMoreChaptersRequest,
  defaultUpdates,
  extractLivewireState,
  isDefaultUpdates,
} from "./livewire";
import {
  DEFAULT_SORT,
  DOMAIN,
  GENRES,
  SORT_OPTIONS,
  TYPE_OPTIONS,
  type LivewireResponse,
  type LivewireState,
  type OnisagaSearchMetadata,
  type PageApiResponse,
  type PostFilterUpdates,
} from "./models";
import { livewireHeaders, OnisagaInterceptor } from "./network";
import {
  countPages,
  extractReaderToken,
  hasNextPage,
  mangaIdFromHref,
  parseChapters,
  parseJson,
  parseMangaCards,
  parseMangaDetails,
  straightenQuotes,
  type MangaCard,
} from "./parsers";
import type OnisagaConfig from "./pbconfig";

export class OnisagaExtension implements ExtensionImpl<typeof OnisagaConfig> {
  requestManager = new OnisagaInterceptor("onisaga-request");
  cookieStorageInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });
  globalRateLimiter = new BasicRateLimiter("onisaga-rate-limiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });

  // Cached Livewire `post-filter` state (token + snapshot) for the active browse
  // URL, refreshed lazily; shared across the discover sections that all hit /browse.
  private browseStateCache?: { url: string; state: LivewireState; at: number };
  private static readonly BROWSE_STATE_TTL = 60_000;

  // Throttle gate for the page-image API (one method owns the rotating token).
  private lastApiAt = 0;

  async initialise(): Promise<void> {
    this.cookieStorageInterceptor.registerInterceptor();
    this.requestManager.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

  async saveCloudflareBypassCookies(cookies: Cookie[]): Promise<void> {
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

  async getSettingsForm(): Promise<Form> {
    return new OnisagaSettingsForm();
  }

  async getAdvancedSearchForm(
    query: SearchQuery<OnisagaSearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    return new OnisagaAdvancedSearchForm(query);
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS.map((option) => ({ id: option.id, label: option.title }));
  }

  // =============================== Discover ====================================

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "most_popular", title: "Most Popular", type: DiscoverSectionType.featured },
      { id: "trending", title: "Trending", type: DiscoverSectionType.prominentCarousel },
      { id: "latest", title: "Latest", type: DiscoverSectionType.simpleCarousel },
      {
        id: "top_rated_read",
        title: "Top Rated · Most Read",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "top_rated_score",
        title: "Top Rated · Highest Rated",
        type: DiscoverSectionType.prominentCarousel,
      },
      { id: "fan_favorites", title: "Fan Favorites", type: DiscoverSectionType.simpleCarousel },
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
      { id: "types", title: "Types", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: { page?: number; collectedIds?: string[] } | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case "most_popular":
        return this.browseDiscover("view", metadata, (card) => ({
          type: "featuredCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          contentRating: card.contentRating,
        }));
      case "trending":
        return this.getTrendingItems();
      case "latest":
        return this.browseDiscover(DEFAULT_SORT, metadata, (card) => ({
          type: "simpleCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          contentRating: card.contentRating,
        }));
      case "top_rated_read":
        return this.browseDiscover("view", metadata, (card) => ({
          type: "simpleCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          contentRating: card.contentRating,
        }));
      case "top_rated_score":
        return this.browseDiscover("vote_average", metadata, (card) => ({
          type: "prominentCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          contentRating: card.contentRating,
        }));
      case "fan_favorites":
        return this.browseDiscover("fan_favorites", metadata, (card) => ({
          type: "simpleCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          contentRating: card.contentRating,
        }));
      case "genres":
        return {
          items: GENRES.map((genre) => ({
            type: "genresCarouselItem",
            searchQuery: {
              title: "",
              metadata: { genres: { [genre.id]: "included" } } satisfies OnisagaSearchMetadata,
            },
            name: genre.title,
          })),
        };
      case "types":
        return {
          items: TYPE_OPTIONS.filter((t) => t.id).map((type) => ({
            type: "genresCarouselItem",
            searchQuery: {
              title: "",
              metadata: { type: type.id } satisfies OnisagaSearchMetadata,
            },
            name: type.title,
          })),
        };
      default:
        return { items: [] };
    }
  }

  private async browseDiscover(
    sort: string,
    metadata: { page?: number; collectedIds?: string[] } | undefined,
    map: (card: MangaCard) => DiscoverSectionItem,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const collectedIds = metadata?.collectedIds ?? [];

    const updates = defaultUpdates();
    updates.sort = sort;
    updates.platform = getDiscoverType();
    updates.status = getDiscoverStatus();
    updates.excludeGenre = getExcludedGenres();

    const { cards, hasNext } = await this.fetchBrowse(`${DOMAIN}/browse`, updates, page);
    const fresh = cards.filter((card) => !collectedIds.includes(card.mangaId));
    collectedIds.push(...fresh.map((card) => card.mangaId));

    return {
      items: fresh.map(map),
      metadata: hasNext ? { page: page + 1, collectedIds } : undefined,
    };
  }

  // The dedicated trending page bundles its Top Rising / by-platform / more rows
  // into one document of the same cards; pull them all, de-duplicate and show
  // them as one carousel. Best-effort: an empty/changed page yields no items
  // rather than an error.
  private async getTrendingItems(): Promise<PagedResults<DiscoverSectionItem>> {
    const showNsfw = getShowNsfw();

    let cards: MangaCard[] = [];
    try {
      const $ = await this.fetchCheerio({ url: `${DOMAIN}/trending`, method: "GET" });
      cards = parseMangaCards($, showNsfw);
    } catch {
      cards = [];
    }

    const seen = new Set<string>();
    const items: DiscoverSectionItem[] = [];
    for (const card of cards) {
      if (seen.has(card.mangaId)) continue;
      seen.add(card.mangaId);
      items.push({
        type: "prominentCarouselItem",
        mangaId: card.mangaId,
        imageUrl: card.imageUrl,
        title: card.title,
        contentRating: card.contentRating,
      });
    }

    return { items };
  }

  // ================================ Search =====================================

  async getSearchResults(
    query: SearchQuery<OnisagaSearchMetadata>,
    metadata: { page?: number } | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const title = straightenQuotes(query.title ?? "").trim();

    if (title.startsWith("http")) {
      const direct = await this.resolveDirectUrl(title);
      if (direct) return { items: [direct] };
    }

    const page = metadata?.page ?? 1;
    const baseUrl = title ? `${DOMAIN}/search/${encodeURIComponent(title)}` : `${DOMAIN}/browse`;
    const updates = this.searchUpdates(query.metadata ?? {}, sortingOption?.id);

    const { cards, hasNext } = await this.fetchBrowse(baseUrl, updates, page);

    return {
      items: cards.map((card) => ({
        mangaId: card.mangaId,
        title: card.title,
        imageUrl: card.imageUrl,
        contentRating: card.contentRating,
      })),
      metadata: hasNext ? { page: page + 1 } : undefined,
    };
  }

  private searchUpdates(meta: OnisagaSearchMetadata, sortId?: string): PostFilterUpdates {
    const updates = defaultUpdates();
    updates.sort = sortId || meta.sort || DEFAULT_SORT;
    updates.platform = meta.type ?? "";
    updates.status = meta.status ?? "";
    updates.min_chapters = meta.minChapters ?? "";

    const included: string[] = [];
    const excluded: string[] = [];
    for (const [id, value] of Object.entries(meta.genres ?? {})) {
      if (value === "included") included.push(id);
      else if (value === "excluded") excluded.push(id);
    }
    updates.genre = included;
    updates.excludeGenre = [...new Set([...excluded, ...getExcludedGenres()])];

    return updates;
  }

  private async resolveDirectUrl(rawUrl: string): Promise<SearchResultItem | undefined> {
    let mangaUrl = rawUrl;
    if (/\/read\//.test(rawUrl)) {
      const $ = await this.fetchCheerio({ url: rawUrl, method: "GET" });
      const href = $("a[href*='/manga/']").first().attr("href");
      if (href) mangaUrl = href;
    }

    const mangaId = mangaIdFromHref(mangaUrl);
    if (!mangaId) return undefined;

    const $ = await this.fetchCheerio({ url: `${DOMAIN}/manga/${mangaId}`, method: "GET" });
    const details = parseMangaDetails($, mangaId);
    return {
      mangaId,
      title: details.mangaInfo.primaryTitle,
      imageUrl: details.mangaInfo.thumbnailUrl ?? "",
      contentRating: details.mangaInfo.contentRating ?? ContentRating.EVERYONE,
    };
  }

  // ============================ Manga & Chapters ===============================

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const $ = await this.fetchCheerio({ url: `${DOMAIN}/manga/${mangaId}`, method: "GET" });
    return parseMangaDetails($, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const mangaUrl = `${DOMAIN}/manga/${sourceManga.mangaId}`;
    const $ = await this.fetchCheerio({ url: mangaUrl, method: "GET" });

    let chapters = parseChapters($, sourceManga);

    const state = extractLivewireState($, "manga.chapter-list");
    if (state) {
      let snapshot = state.snapshot;
      // The site renders the whole list in one Livewire call; the loop is a guard
      // for any source that still paginates, and stops as soon as it stops growing.
      for (let i = 0; i < 50; i++) {
        let json: LivewireResponse;
        try {
          const [, buffer] = await Application.scheduleRequest({
            url: `${DOMAIN}/livewire/update`,
            method: "POST",
            headers: livewireHeaders(mangaUrl),
            body: JSON.stringify(buildLoadMoreChaptersRequest({ token: state.token, snapshot })),
          });
          json = parseJson<LivewireResponse>(
            Application.arrayBufferToUTF8String(buffer),
            "livewire chapters",
          );
        } catch {
          break;
        }

        const html = json.components?.[0]?.effects?.html;
        if (!html) break;

        const next = parseChapters(cheerio.load(html), sourceManga);
        if (next.length <= chapters.length) break;
        chapters = next;

        const newSnapshot = json.components?.[0]?.snapshot;
        if (!newSnapshot) break;
        snapshot = newSnapshot;
      }
    }

    chapters.sort((a, b) => b.chapNum - a.chapNum);
    chapters.forEach((chapter, index) => {
      chapter.sortingIndex = index;
    });
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = `${DOMAIN}${chapter.chapterId}`;
    const segments = chapter.chapterId.split("/").filter(Boolean);
    const cid = segments[segments.length - 1];

    const [, buffer] = await Application.scheduleRequest({ url: chapterUrl, method: "GET" });
    const body = Application.arrayBufferToUTF8String(buffer);

    let token = extractReaderToken(body);
    if (!token) throw new Error("Could not find reader token on chapter page");

    const pageCount = countPages(body);
    if (pageCount === 0) throw new Error("No pages found in chapter");

    const pages: string[] = [];
    for (let order = 0; order < pageCount; order++) {
      const resolved = await this.resolvePageUrl(cid, order, chapterUrl, token);
      pages.push(resolved.url);
      token = resolved.token;
    }

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }

  // Sequentially resolve a single page's CDN url, carrying the rotating reader
  // token forward and refreshing it from the chapter page when it expires.
  private async resolvePageUrl(
    cid: string,
    order: number,
    chapterUrl: string,
    token: string,
  ): Promise<{ url: string; token: string }> {
    let currentToken = token;

    for (let attempt = 0; attempt < 3; attempt++) {
      await this.throttleImageApi();

      const [response, buffer] = await Application.scheduleRequest({
        url: `${DOMAIN}/api/chapter/${cid}/page/${order}`,
        method: "GET",
        headers: {
          "X-Reader-Token": currentToken,
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
          Referer: chapterUrl,
        },
      });

      const nextToken = response.headers?.["x-reader-token-next"];
      if (nextToken) currentToken = nextToken;

      if (response.status === 429) {
        const retryAfter = Number(response.headers?.["retry-after"]);
        await Application.sleep(
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : getImageRateLimitMs() / 1000,
        );
        continue;
      }

      const dto = parseJson<PageApiResponse>(
        Application.arrayBufferToUTF8String(buffer),
        `chapter page ${order}`,
      );
      if (dto.url) return { url: dto.url, token: currentToken };

      const expired =
        response.status >= 400 || (dto.message != null && /expired/i.test(dto.message));
      if (expired) {
        const [, refreshBuffer] = await Application.scheduleRequest({
          url: chapterUrl,
          method: "GET",
        });
        const fresh = extractReaderToken(Application.arrayBufferToUTF8String(refreshBuffer));
        if (fresh) {
          currentToken = fresh;
          continue;
        }
      }

      throw new Error(`Failed to load page ${order}: ${dto.message ?? `HTTP ${response.status}`}`);
    }

    throw new Error(`Failed to load page ${order} after 3 attempts`);
  }

  private async throttleImageApi(): Promise<void> {
    const gap = getImageRateLimitMs();
    const elapsed = Date.now() - this.lastApiAt;
    if (elapsed < gap) await Application.sleep((gap - elapsed) / 1000);
    this.lastApiAt = Date.now();
  }

  // ============================== Livewire browse ==============================

  private async fetchBrowse(
    baseUrl: string,
    updates: PostFilterUpdates,
    page: number,
  ): Promise<{ cards: MangaCard[]; hasNext: boolean }> {
    const showNsfw = getShowNsfw();

    // Page 1 with default filters: the server-rendered HTML already holds the
    // first batch, so skip the Livewire round-trip.
    if (page === 1 && isDefaultUpdates(updates)) {
      const $ = await this.fetchCheerio({ url: baseUrl, method: "GET" });
      const state = extractLivewireState($, "post-filter");
      if (state) this.browseStateCache = { url: baseUrl, state, at: Date.now() };
      return { cards: parseMangaCards($, showNsfw), hasNext: hasNextPage($) };
    }

    const state = await this.resolveBrowseState(baseUrl);
    if (!state) return { cards: [], hasNext: false };

    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/livewire/update`,
      method: "POST",
      headers: livewireHeaders(baseUrl),
      body: JSON.stringify(buildBrowseRequest(state, updates, page)),
    });

    const json = parseJson<LivewireResponse>(
      Application.arrayBufferToUTF8String(buffer),
      "livewire browse",
    );
    const html = json.components?.[0]?.effects?.html;
    if (!html) {
      this.browseStateCache = undefined;
      return { cards: [], hasNext: false };
    }

    const newSnapshot = json.components?.[0]?.snapshot;
    if (newSnapshot) {
      this.browseStateCache = {
        url: baseUrl,
        state: { token: state.token, snapshot: newSnapshot },
        at: Date.now(),
      };
    }

    const $ = cheerio.load(html);
    return { cards: parseMangaCards($, showNsfw), hasNext: hasNextPage($) };
  }

  private async resolveBrowseState(baseUrl: string): Promise<LivewireState | undefined> {
    const now = Date.now();
    const cached = this.browseStateCache;
    if (cached && cached.url === baseUrl && now - cached.at < OnisagaExtension.BROWSE_STATE_TTL) {
      return cached.state;
    }

    const $ = await this.fetchCheerio({ url: baseUrl, method: "GET" });
    const state = extractLivewireState($, "post-filter");
    if (state) this.browseStateCache = { url: baseUrl, state, at: now };
    return state;
  }

  async fetchCheerio(request: Request): Promise<cheerio.CheerioAPI> {
    const [, data] = await Application.scheduleRequest(request);
    return cheerio.load(Application.arrayBufferToUTF8String(data));
  }
}

export const Onisaga = new OnisagaExtension();
