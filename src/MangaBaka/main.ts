/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  type Cookie,
  type Chapter,
  type ChapterReadActionQueueProcessingResult,
  type CloudflareBypassRequestProviding,
  type DiscoverSection,
  type DiscoverSectionItem,
  DiscoverSectionType,
  type DiscoverSectionProviding,
  type Extension,
  type FeaturedCarouselItem,
  type Form,
  type MangaProgress,
  type MangaProgressProviding,
  type Metadata,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SearchResultsProviding,
  type SettingsFormProviding,
  type SortingOption,
  type SourceManga,
  type TrackedMangaChapterReadAction,
} from "@paperback/types";

import { ProgressForm } from "./forms/progress";
import { SearchFiltersForm } from "./forms/search";
import { SettingsForm } from "./forms/settings";
import {
  DISCOVER_LIMIT,
  type Envelope,
  type LibraryEntry,
  type PagedEnvelope,
  PROGRESS_MAX,
  SEARCH_LIMIT,
  SEARCH_MAX_PAGE,
  type SearchFilters,
  type Series,
  SORT_OPTIONS,
} from "./models";
import {
  getGenreOptions,
  isAuthenticated,
  MangaBakaError,
  MangaBakaInterceptor,
  makeRequest,
  cookieStorage,
  shouldRetryLater,
} from "./network";
import {
  chaptersLabel,
  contentRatingFor,
  parseSourceManga,
  ratingLabel,
  seriesSubtitle,
  seriesThumbnail,
  seriesTitle,
  statusLabel,
  typeLabel,
  volumesLabel,
} from "./parsers";

const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
  { id: "trending", title: "Trending", type: DiscoverSectionType.prominentCarousel },
  { id: "rising", title: "Rising", type: DiscoverSectionType.simpleCarousel },
  { id: "latest", title: "Latest", type: DiscoverSectionType.simpleCarousel },
  { id: "new-releases", title: "New Releases", type: DiscoverSectionType.simpleCarousel },
  { id: "hidden-gems", title: "Hidden Gems", type: DiscoverSectionType.prominentCarousel },
];

// Two rows come from endpoints dedicated to them; the rest are fixed searches.
// Every one of these is a constant URL, so they all share a cache key across
// installs rather than spending anyone's search budget.
const DISCOVER_PATHS: Record<string, string> = {
  // Popularity is a rank where one is the most popular.
  popular: `/v2/series/search?sort_by=popularity_asc&limit=${DISCOVER_LIMIT}`,
  trending: `/v2/series/search?sort_by=trending_7d&limit=${DISCOVER_LIMIT}`,
  rising: "/v2/series/discover/rising",
  latest: `/v2/series/search?sort_by=latest&limit=${DISCOVER_LIMIT}`,
  "new-releases": `/v2/series/search?sort_by=published_start_date_desc&limit=${DISCOVER_LIMIT}`,
  "hidden-gems": "/v2/series/discover/hidden-gems",
};

// What each row shows beneath the title.
const DISCOVER_DETAILS: Record<string, "volumes" | "status"> = {
  trending: "volumes",
  rising: "volumes",
  latest: "status",
  "new-releases": "volumes",
  "hidden-gems": "volumes",
};

// The filter form hands its selection back through the query metadata, which
// the app carries across pages for us.
function readFilters(query: SearchQuery<Metadata>): SearchFilters {
  const metadata = query.metadata;
  return metadata != undefined && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as SearchFilters)
    : {};
}

// Progress is stored as a number between zero and ten thousand; anything
// outside that is rejected, and a rejected write never drains from the queue.
function clampProgress(value: number): number {
  return Math.min(PROGRESS_MAX, Math.max(0, value));
}

function appendAll(params: string[], key: string, values: string[] | undefined): void {
  for (const value of values ?? []) {
    params.push(`${key}=${encodeURIComponent(value)}`);
  }
}

// The app rejects an item whose image URL is not a URL, and takes the whole
// row down with it, so a series with no cover art is left out rather than
// handed over with an empty one.
function toSearchResultItem(series: Series): SearchResultItem | undefined {
  const imageUrl = seriesThumbnail(series);
  if (imageUrl == undefined) return undefined;

  return {
    mangaId: String(series.id),
    title: seriesTitle(series),
    imageUrl,
    subtitle: seriesSubtitle(series),
    contentRating: contentRatingFor(series),
  };
}

function isPresent<T>(value: T | undefined): value is T {
  return value != undefined;
}

// At most two facts fit on a featured card, so it gets the chapter count and
// the rating.
function featuredInfoItems(series: Series): FeaturedCarouselItem["infoItems"] {
  const pills: { symbol: string; text: string }[] = [];

  const chapters = chaptersLabel(series);
  if (chapters) pills.push({ symbol: "book.fill", text: chapters });

  const rating = ratingLabel(series);
  if (rating) pills.push({ symbol: "star.fill", text: rating });

  if (pills.length === 0) return undefined;
  return pills.length === 1 ? [pills[0]!] : [pills[0]!, pills[1]!];
}

function detailSubtitle(series: Series, detail: "volumes" | "status"): string | undefined {
  const parts = [
    chaptersLabel(series),
    detail === "volumes" ? volumesLabel(series) : statusLabel(series),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" • ") : undefined;
}

function toDiscoverItem(series: Series, section: DiscoverSection): DiscoverSectionItem | undefined {
  const imageUrl = seriesThumbnail(series);
  if (imageUrl == undefined) return undefined;

  const base = {
    mangaId: String(series.id),
    title: seriesTitle(series),
    imageUrl,
    contentRating: contentRatingFor(series),
  };

  if (section.type === DiscoverSectionType.featured) {
    return {
      ...base,
      type: "featuredCarouselItem",
      supertitle: typeLabel(series),
      summary: series.description ?? undefined,
      infoItems: featuredInfoItems(series),
    };
  }

  const subtitle = detailSubtitle(series, DISCOVER_DETAILS[section.id] ?? "volumes");

  if (section.type === DiscoverSectionType.prominentCarousel) {
    return { ...base, type: "prominentCarouselItem", subtitle };
  }

  return { ...base, type: "simpleCarouselItem", subtitle };
}

export class MangaBakaExtension
  implements
    Extension,
    CloudflareBypassRequestProviding,
    DiscoverSectionProviding,
    MangaProgressProviding,
    SearchResultsProviding,
    SettingsFormProviding
{
  // The documented 30/min search limit only counts cache misses, and most
  // responses are served from cache, so the balanced preset is enough.
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: true,
  });
  mainInterceptor = new MangaBakaInterceptor("main");

  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    cookieStorage.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new SettingsForm();
  }

  async cloudflareBypassCompleted(_request: Request, cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.domain.replace(/^\./, "").endsWith("mangabaka.org")) {
        cookieStorage.setCookie(cookie);
      }
    }
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    // Tags only exist on the `full` schema; the lean default omits them.
    const response = await makeRequest<Envelope<Series>>(`/v2/series/${mangaId}?schema=full`);
    return parseSourceManga(response.data);
  }

  async getSortingOptions(_query: SearchQuery<Metadata>): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<SearchFiltersForm> {
    let genreOptions: { id: string; title: string }[] = [];
    try {
      genreOptions = await getGenreOptions();
    } catch {
      // The rest of the filters are worth offering on their own.
    }

    return new SearchFiltersForm(readFilters(query), genreOptions);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = typeof metadata === "number" ? metadata : 1;
    const filters = readFilters(query);

    // `URLSearchParams` is absent from the app's JavaScript runtime, so the
    // query string is assembled by hand. Repeated keys are how the endpoint
    // takes its array parameters.
    const params = [`page=${page}`, `limit=${SEARCH_LIMIT}`];
    if (query.title) {
      params.push(`q=${encodeURIComponent(query.title)}`);
    }
    if (sortingOption) {
      params.push(`sort_by=${sortingOption.id}`);
    }
    // Genres are tags to the endpoint.
    const includedGenres = filters.genres ?? [];
    appendAll(params, "tag", includedGenres);
    appendAll(params, "tag_not", filters.excludeGenres);
    if (filters.tagMode && includedGenres.length > 1) {
      params.push(`tag_mode=${filters.tagMode}`);
    }
    appendAll(params, "type", filters.types);
    appendAll(params, "type_not", filters.excludeTypes);
    appendAll(params, "status", filters.statuses);
    appendAll(params, "status_not", filters.excludeStatuses);
    appendAll(params, "content_rating", filters.contentRatings);
    // The negative form of this one is spelled the other way round.
    appendAll(params, "not_content_rating", filters.excludeContentRatings);
    if (filters.licensedOnly) {
      params.push("is_licensed=true");
    }

    const response = await makeRequest<PagedEnvelope<Series>>(
      `/v2/series/search?${params.join("&")}`,
    );

    return {
      items: (response.data ?? []).map(toSearchResultItem).filter(isPresent),
      metadata: response.pagination?.next && page < SEARCH_MAX_PAGE ? page + 1 : undefined,
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const path = DISCOVER_PATHS[section.id];
    if (path == undefined) return { items: [] };

    const response = await makeRequest<PagedEnvelope<Series>>(path);

    return {
      items: (response.data ?? [])
        .map((series) => toDiscoverItem(series, section))
        .filter(isPresent),
    };
  }

  async getMangaProgressManagementForm(sourceManga: SourceManga): Promise<Form> {
    return new ProgressForm(sourceManga.mangaId);
  }

  async getMangaProgress(sourceManga: SourceManga): Promise<MangaProgress | undefined> {
    if (!isAuthenticated()) return undefined;

    let entry: LibraryEntry;
    try {
      const response = await makeRequest<Envelope<LibraryEntry>>(
        `/v1/my/library/${sourceManga.mangaId}`,
        { needsAuth: true },
      );
      entry = response.data;
    } catch (error) {
      // Only a 404 means the title is untracked. Reporting anything else the
      // same way invites the reader to add a title they already have, which
      // would overwrite the rating and note they had on it.
      if (error instanceof MangaBakaError && error.status === 404) return undefined;
      throw error;
    }

    const chapterNumber = entry.progress_chapter ?? 0;
    const lastReadChapter: Chapter = {
      chapterId: String(chapterNumber),
      sourceManga,
      langCode: "unknown",
      chapNum: chapterNumber,
      // A fresh entry stores zero, which is not a volume anyone has read.
      volume: entry.progress_volume ? entry.progress_volume : undefined,
    };

    return {
      sourceManga,
      lastReadChapter,
      userRating: entry.rating == null ? undefined : entry.rating / 10,
    };
  }

  async processChapterReadActionQueue(
    actions: TrackedMangaChapterReadAction[],
  ): Promise<ChapterReadActionQueueProcessingResult> {
    const result: ChapterReadActionQueueProcessingResult = {
      successfulItems: [],
      failedItems: [],
    };

    // Someone who has not signed in yet has not failed anything. Leaving the
    // actions unreported keeps them queued for when they do.
    if (!isAuthenticated()) return result;

    const furthest = new Map<string, { chapter: number; volume: number; actionIds: string[] }>();
    for (const action of actions) {
      const seriesId = action.sourceManga.mangaId;
      const previous = furthest.get(seriesId);
      furthest.set(seriesId, {
        // Chapter numbers are fractional on plenty of series, and the endpoint
        // stores them that way, so they are carried through as they are.
        chapter: Math.max(previous?.chapter ?? -1, clampProgress(action.chapterNum)),
        volume: Math.max(
          previous?.volume ?? -1,
          action.chapterVolume == undefined ? -1 : clampProgress(action.chapterVolume),
        ),
        actionIds: [...(previous?.actionIds ?? []), action.id],
      });
    }

    const groups = [...furthest.entries()];
    for (let offset = 0; offset < groups.length; offset += 100) {
      const batch = groups.slice(offset, offset + 100);
      const batchActionIds = batch.flatMap(([, progress]) => progress.actionIds);
      let pendingActionIds = batchActionIds;
      try {
        const query = batch
          .map(([seriesId]) => `series_id=${encodeURIComponent(seriesId)}`)
          .join("&");
        const response = await makeRequest<Envelope<LibraryEntry[]>>(
          `/v1/my/library/batch?${query}`,
          { needsAuth: true },
        );
        const currentBySeries = new Map(
          response.data
            .filter((entry) => entry.series_id != undefined)
            .map((entry) => [String(entry.series_id), entry]),
        );
        const writes: Record<string, unknown>[] = [];

        for (const [seriesId, progress] of batch) {
          const current = currentBySeries.get(seriesId);
          const currentChapter = current?.progress_chapter ?? 0;
          const currentVolume = current?.progress_volume ?? 0;
          const chapter = Math.max(currentChapter, progress.chapter);
          const volume = Math.max(currentVolume, progress.volume);

          if (current != undefined && chapter === currentChapter && volume === currentVolume) {
            result.successfulItems.push(...progress.actionIds);
            continue;
          }

          const body: Record<string, unknown> = {
            series_id: Number(seriesId),
            progress_chapter: chapter,
          };
          if (volume >= 0) body.progress_volume = volume;
          if (current == undefined) body.state = "reading";
          writes.push(body);
        }

        if (writes.length > 0) {
          const writtenSeries = new Set(writes.map((write) => String(write.series_id)));
          pendingActionIds = batch
            .filter(([seriesId]) => writtenSeries.has(seriesId))
            .flatMap(([, progress]) => progress.actionIds);
          await makeRequest("/v1/my/library/batch", {
            method: "POST",
            needsAuth: true,
            body: writes,
          });
          for (const [seriesId, progress] of batch) {
            if (writtenSeries.has(seriesId)) result.successfulItems.push(...progress.actionIds);
          }
        }
      } catch (error) {
        // A rate limit, an outage or an expired credential is not a write that
        // failed, it is one that never happened. Reporting those would count
        // an error against actions that deserve another attempt.
        if (!shouldRetryLater(error)) {
          result.failedItems.push(...pendingActionIds);
        }
      }
    }

    return result;
  }
}

export const MangaBaka = new MangaBakaExtension();
