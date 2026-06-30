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
  type FeaturedCarouselItem,
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
  buildStatSubtitle,
  countPages,
  extractReaderToken,
  hasNextPage,
  mangaIdFromHref,
  parseChapters,
  parseJson,
  parseMangaCards,
  parseMangaDetails,
  parseTopManga,
  sliceSectionHtml,
  straightenQuotes,
  topMangaSubtitle,
  type MangaCard,
  type TopMangaItem,
} from "./parsers";
import type OnisagaConfig from "./pbconfig";

// Featured hero stat pills from a top-manga ranking row: ★ rating and a flame
// read-count, each shown only when the row carried it.
function topMangaInfoItems(item: TopMangaItem): FeaturedCarouselItem["infoItems"] {
  const pills: { symbol: string; text: string }[] = [];
  if (item.rating) pills.push({ symbol: "star.fill", text: item.rating });
  if (item.reads) pills.push({ symbol: "flame.fill", text: item.reads });
  if (pills.length === 0) return undefined;
  return (
    pills.length === 1 ? [pills[0]] : [pills[0], pills[1]]
  ) as FeaturedCarouselItem["infoItems"];
}

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

  // Cached server-rendered home document, shared by the home-sourced rails.
  private homeHtmlCache?: { html: string; at: number };
  private static readonly HOME_TTL = 60_000;

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
      { id: "top_manga", title: "Top Manga", type: DiscoverSectionType.featured },
      { id: "latest", title: "Latest", type: DiscoverSectionType.simpleCarousel },
      { id: "most_popular", title: "Most Popular", type: DiscoverSectionType.prominentCarousel },
      { id: "top_10_rising", title: "Top 10 Rising", type: DiscoverSectionType.prominentCarousel },
      {
        id: "trending_platform",
        title: "Trending by Platform",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: "more_trending", title: "More Trending", type: DiscoverSectionType.simpleCarousel },
      { id: "fan_favorites", title: "Fan Favorites", type: DiscoverSectionType.simpleCarousel },
      { id: "highest_rated", title: "Highest Rated", type: DiscoverSectionType.prominentCarousel },
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
      { id: "types", title: "Types", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: { page?: number; collectedIds?: string[] } | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    switch (section.id) {
      case "top_manga": {
        const items = await this.fetchTopManga("reads");
        return {
          items: items.map((item) => ({
            type: "featuredCarouselItem",
            mangaId: item.mangaId,
            imageUrl: item.imageUrl,
            title: item.title,
            supertitle: item.genres,
            infoItems: topMangaInfoItems(item),
            contentRating: item.contentRating,
          })),
        };
      }
      case "latest":
        return this.browseDiscover(DEFAULT_SORT, metadata, (card) => ({
          type: "simpleCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          subtitle: buildStatSubtitle(card),
          contentRating: card.contentRating,
        }));
      case "most_popular":
        return this.homeSectionItems("Most Popular", (card) => ({
          type: "prominentCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          subtitle: buildStatSubtitle(card),
          contentRating: card.contentRating,
        }));
      case "top_10_rising":
        return this.homeSectionItems("Top 10 Rising", (card) => ({
          type: "prominentCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          subtitle: buildStatSubtitle(card),
          contentRating: card.contentRating,
        }));
      case "trending_platform":
        return this.homeSectionItems("Trending by Platform", (card) => ({
          type: "simpleCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          subtitle: buildStatSubtitle(card),
          contentRating: card.contentRating,
        }));
      case "more_trending":
        return this.homeSectionItems("More Trending", (card) => ({
          type: "simpleCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          subtitle: buildStatSubtitle(card),
          contentRating: card.contentRating,
        }));
      case "fan_favorites":
        return this.browseDiscover("fan_favorites", metadata, (card) => ({
          type: "simpleCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          subtitle: buildStatSubtitle(card),
          contentRating: card.contentRating,
        }));
      case "highest_rated": {
        const items = await this.fetchTopManga("rated");
        return {
          items: items.map((item) => ({
            type: "prominentCarouselItem",
            mangaId: item.mangaId,
            imageUrl: item.imageUrl,
            title: item.title,
            subtitle: topMangaSubtitle(item),
            contentRating: item.contentRating,
          })),
        };
      }
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

  // The /top-manga ranking page sorts every title by total reads (?sort=reads)
  // or by rating (?sort=rated). Its rows carry the read count and ★ rating that
  // /browse cards lack, so the featured hero and Highest Rated carousel use it.
  // Best-effort: a changed/empty page yields no items rather than an error.
  private async fetchTopManga(sort: "reads" | "rated"): Promise<TopMangaItem[]> {
    const showNsfw = getShowNsfw();
    try {
      const $ = await this.fetchCheerio({ url: `${DOMAIN}/top-manga?sort=${sort}`, method: "GET" });
      return parseTopManga($, showNsfw);
    } catch {
      return [];
    }
  }

  // The home page stacks all of its curated rails (Most Popular, Top 10 Rising,
  // Trending by Platform, More Trending, …) in one server-rendered document, so
  // fetch it once and slice out a rail by its heading. Cached briefly because
  // several discover sections share the same document.
  private async fetchHomeHtml(): Promise<string> {
    const now = Date.now();
    const cached = this.homeHtmlCache;
    if (cached && now - cached.at < OnisagaExtension.HOME_TTL) return cached.html;

    const [, buffer] = await Application.scheduleRequest({ url: `${DOMAIN}/home`, method: "GET" });
    const html = Application.arrayBufferToUTF8String(buffer);
    this.homeHtmlCache = { html, at: now };
    return html;
  }

  // Parse one home rail into discover items. Best-effort: a missing/renamed
  // heading yields no items rather than an error.
  private async homeSectionItems(
    heading: string,
    map: (card: MangaCard) => DiscoverSectionItem,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    let cards: MangaCard[] = [];
    try {
      const slice = sliceSectionHtml(await this.fetchHomeHtml(), heading);
      if (slice) cards = parseMangaCards(cheerio.load(slice), getShowNsfw());
    } catch {
      cards = [];
    }

    const seen = new Set<string>();
    const items: DiscoverSectionItem[] = [];
    for (const card of cards) {
      if (seen.has(card.mangaId)) continue;
      seen.add(card.mangaId);
      items.push(map(card));
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
