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
  getSectionsOrder,
  getShowNsfw,
  OnisagaAdvancedSearchForm,
  OnisagaSettingsForm,
} from "./forms";
import {
  DEFAULT_SORT,
  DOMAIN,
  GENRES,
  SECTION_TOGGLES,
  SORT_OPTIONS,
  TYPE_OPTIONS,
  type LivewireResponse,
  type LivewireState,
  type OnisagaSearchMetadata,
  type PostFilterUpdates,
} from "./models";
import { OnisagaInterceptor } from "./network";
import {
  buildStatSubtitle,
  countPages,
  extractReaderToken,
  hasNextPage,
  parseChapters,
  parseMangaCards,
  parseMangaDetails,
  parseTopManga,
  sliceSectionHtml,
  topMangaSubtitle,
  type MangaCard,
  type TopMangaItem,
} from "./parsers";
import type OnisagaConfig from "./pbconfig";
import { mangaIdFromHref, parseJson, straightenQuotes } from "./utils/helpers";
import {
  buildBrowseRequest,
  buildLoadMoreChaptersRequest,
  buildSectionToggleRequest,
  defaultUpdates,
  extractLivewireState,
  isDefaultUpdates,
  livewireHeaders,
} from "./utils/livewire";

// How many ranked titles the featured hero shows, taken straight from the
// /top-manga ranking (no per-item requests).
const FEATURED_LIMIT = 10;

// Carousel style per discover rail id (the user can reorder/hide rails, but the
// style is fixed by what each rail renders best as). Rails with an on-site toggle
// render as chip rows (Day/Week/Month, platform, …) — MangaDot's pattern.
function discoverSectionType(id: string): DiscoverSectionType {
  if (SECTION_TOGGLES[id]) return DiscoverSectionType.genres;
  switch (id) {
    case "top_manga":
      return DiscoverSectionType.featured;
    case "highest_rated":
      return DiscoverSectionType.prominentCarousel;
    case "genres":
    case "types":
      return DiscoverSectionType.genres;
    default:
      return DiscoverSectionType.simpleCarousel;
  }
}

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
  // The site runs a strict per-IP Laravel throttle, so stay well under it: a
  // burst of HTML/API requests trips the limit and then 429s the reader's page
  // API. 3/s keeps browsing responsive while leaving headroom for the reader;
  // CDN images are ignored and load freely.
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
    return getSectionsOrder().map((section) => ({
      id: section.id,
      title: section.title,
      type: discoverSectionType(section.id),
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: { page?: number; collectedIds?: string[] } | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    // Toggle rails render as chip rows; each chip carries the rail + option in its
    // search metadata so a tap runs the ranged fetch through getSearchResults.
    const toggle = SECTION_TOGGLES[section.id];
    if (toggle) {
      return {
        items: toggle.options.map((option) => ({
          type: "genresCarouselItem",
          searchQuery: {
            title: "",
            metadata: {
              toggleSection: section.id,
              toggleValue: option.id,
            } satisfies OnisagaSearchMetadata,
          },
          name: option.title,
        })),
      };
    }

    switch (section.id) {
      case "top_manga":
        return this.getTopMangaFeatured();
      case "latest":
        return this.browseDiscover(DEFAULT_SORT, metadata, (card) => ({
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
      case "fan_favorites":
        return this.homeRailSection("Fan Favorites");
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

  // Featured hero: the most-read ranking, enriched with author + synopsis. The
  // ranking page carries no author/description, so the top few are looked up on
  // their detail pages (capped to keep the request count bounded). Enrichment is
  // best-effort — a failed lookup just drops the author/summary for that item.
  private async getTopMangaFeatured(): Promise<PagedResults<DiscoverSectionItem>> {
    const items = (await this.fetchTopManga("reads")).slice(0, FEATURED_LIMIT);

    // Build the hero straight from the /top-manga ranking (one request). We used
    // to fan out a /manga/{id} fetch per item to add author + synopsis, but that
    // fired 10 burst requests at app launch and helped trip the site's per-IP
    // throttle — which then 429s the reader's page API on the very first page.
    // The ranking already carries genres + reads + rating, which is enough for
    // the hero; author/synopsis show once the user opens the title.
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

  // The /trending page server-renders every curated rail (Most Popular, Fan
  // Favorites, Top 10 Rising, Trending by Platform, More Trending) eagerly in one
  // document, whereas /home lazy-loads the lower rails via Livewire (so a plain
  // fetch misses them). Pull /trending once and slice each rail out by heading.
  private async fetchHomeHtml(): Promise<string> {
    const now = Date.now();
    const cached = this.homeHtmlCache;
    if (cached && now - cached.at < OnisagaExtension.HOME_TTL) return cached.html;

    const [, buffer] = await Application.scheduleRequest({
      url: `${DOMAIN}/trending`,
      method: "GET",
    });
    const html = Application.arrayBufferToUTF8String(buffer);
    this.homeHtmlCache = { html, at: now };
    return html;
  }

  // A curated rail (e.g. Fan Favorites) is server-rendered into the home/trending
  // document, so slice it out by heading and parse its cards — no Livewire
  // round-trip, so it's as reliable as the page load. Best-effort: a missing rail
  // yields no items rather than an error.
  private async homeRailSection(heading: string): Promise<PagedResults<DiscoverSectionItem>> {
    try {
      const section = sliceSectionHtml(await this.fetchHomeHtml(), heading);
      if (!section) return { items: [] };
      const cards = parseMangaCards(cheerio.load(section), getShowNsfw());
      return {
        items: cards.map((card) => ({
          type: "simpleCarouselItem",
          mangaId: card.mangaId,
          imageUrl: card.imageUrl,
          title: card.title,
          subtitle: buildStatSubtitle(card),
          contentRating: card.contentRating,
        })),
      };
    } catch {
      return { items: [] };
    }
  }

  // A discover toggle chip was tapped: drive the rail's Livewire method
  // (setPeriod / setSort / setPlatform) on /trending and return the re-rendered
  // cards. Best-effort: a missing component/HTML yields no results, not an error.
  private async getToggledSection(
    sectionId: string,
    value: string,
  ): Promise<PagedResults<SearchResultItem>> {
    const toggle = SECTION_TOGGLES[sectionId];
    if (!toggle) return { items: [] };

    try {
      const trendingUrl = `${DOMAIN}/trending`;
      const $ = cheerio.load(await this.fetchHomeHtml());
      const state = extractLivewireState($, toggle.component);
      if (!state) return { items: [] };

      const [, buffer] = await Application.scheduleRequest({
        url: `${DOMAIN}/livewire/update`,
        method: "POST",
        headers: livewireHeaders(trendingUrl),
        body: JSON.stringify(buildSectionToggleRequest(state, toggle.method, value)),
      });
      const json = parseJson<LivewireResponse>(
        Application.arrayBufferToUTF8String(buffer),
        "livewire toggle",
      );
      const html = json.components?.[0]?.effects?.html;
      const cards = html ? parseMangaCards(cheerio.load(html), getShowNsfw()) : [];

      return {
        items: cards.map((card) => ({
          mangaId: card.mangaId,
          title: card.title,
          imageUrl: card.imageUrl,
          contentRating: card.contentRating,
        })),
      };
    } catch {
      return { items: [] };
    }
  }

  // ================================ Search =====================================

  async getSearchResults(
    query: SearchQuery<OnisagaSearchMetadata>,
    metadata: { page?: number } | undefined,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    // A discover toggle chip routes here with no title — fetch its ranged cards.
    if (query.metadata?.toggleSection) {
      return this.getToggledSection(query.metadata.toggleSection, query.metadata.toggleValue ?? "");
    }

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

    // The chapter list is paginated client-side; one Livewire call that bumps the
    // loaded-counts past any real series returns the whole list at once.
    const state = extractLivewireState($, "manga.chapter-list");
    if (state) {
      try {
        const [, buffer] = await Application.scheduleRequest({
          url: `${DOMAIN}/livewire/update`,
          method: "POST",
          headers: livewireHeaders(mangaUrl),
          body: JSON.stringify(buildLoadMoreChaptersRequest(state)),
        });
        const json = parseJson<LivewireResponse>(
          Application.arrayBufferToUTF8String(buffer),
          "livewire chapters",
        );
        const html = json.components?.[0]?.effects?.html;
        if (html) {
          const full = parseChapters(cheerio.load(html), sourceManga);
          if (full.length > chapters.length) chapters = full;
        }
      } catch {
        // Keep the first server-rendered page if the bulk load fails.
      }
    }

    chapters.sort((a, b) => b.chapNum - a.chapNum);
    chapters.forEach((chapter, index) => {
      chapter.sortingIndex = index;
    });
    return chapters;
  }

  // Opening a chapter is one request: fetch the reader page for its token + page
  // count, then hand Paperback a page-API url per page WITHOUT resolving any of
  // them. Each page's signed image is fetched lazily by the interceptor only when
  // the reader displays it (see OnisagaInterceptor). Resolving all ~80 pages up
  // front took ~35s and tripped the site's per-IP throttle; lazy resolution opens
  // instantly and only ever touches pages the reader actually shows.
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = `${DOMAIN}${chapter.chapterId}`;
    const segments = chapter.chapterId.split("/").filter(Boolean);
    const cid = segments[segments.length - 1] ?? "";

    const [, buffer] = await Application.scheduleRequest({ url: chapterUrl, method: "GET" });
    const body = Application.arrayBufferToUTF8String(buffer);

    const token = extractReaderToken(body);
    if (!token) throw new Error("Could not find reader token on chapter page");

    const pageCount = countPages(body);
    if (pageCount === 0) throw new Error("No pages found in chapter");

    this.requestManager.setReaderToken(cid, token);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: Array.from(
        { length: pageCount },
        (_, order) => `${DOMAIN}/api/chapter/${cid}/page/${order}`,
      ),
    };
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
