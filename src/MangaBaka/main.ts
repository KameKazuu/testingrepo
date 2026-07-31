/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  BasicRateLimiter,
  type Chapter,
  type ChapterReadActionQueueProcessingResult,
  type DiscoverSection,
  type DiscoverSectionItem,
  DiscoverSectionType,
  type DiscoverSectionProviding,
  type Extension,
  type Form,
  type MangaProgress,
  type MangaProgressProviding,
  type Metadata,
  type PagedResults,
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
  type Envelope,
  type LibraryEntry,
  type PagedEnvelope,
  PROGRESS_MAX,
  SEARCH_LIMIT,
  SEARCH_MAX_PAGE,
  type SearchFilters,
  type Series,
  SORT_OPTIONS,
  type TagOption,
} from "./models";
import {
  getTagOptions,
  isAuthenticated,
  MangaBakaError,
  MangaBakaInterceptor,
  makeRequest,
  shouldRetryLater,
} from "./network";
import {
  contentRatingFor,
  parseSourceManga,
  seriesSubtitle,
  seriesThumbnail,
  seriesTitle,
} from "./parsers";

// Only the dedicated discover endpoints are used, and they are called without
// query parameters so every extension shares one cache key. Search is kept out
// of discover: its 30/min budget belongs to the user's own searches, and unlike
// these endpoints it is not known to be cached.
const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: "rising", title: "Rising", type: DiscoverSectionType.featured },
  { id: "hidden-gems", title: "Hidden Gems", type: DiscoverSectionType.prominentCarousel },
];

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

function toSearchResultItem(series: Series): SearchResultItem {
  return {
    mangaId: String(series.id),
    title: seriesTitle(series),
    imageUrl: seriesThumbnail(series),
    subtitle: seriesSubtitle(series),
    contentRating: contentRatingFor(series),
  };
}

function toDiscoverItem(series: Series, sectionType: DiscoverSectionType): DiscoverSectionItem {
  const base = {
    mangaId: String(series.id),
    title: seriesTitle(series),
    imageUrl: seriesThumbnail(series),
    contentRating: contentRatingFor(series),
  };

  if (sectionType === DiscoverSectionType.featured) {
    return {
      ...base,
      type: "featuredCarouselItem",
      supertitle: seriesSubtitle(series),
      summary: series.description ?? undefined,
    };
  }

  if (sectionType === DiscoverSectionType.prominentCarousel) {
    return { ...base, type: "prominentCarouselItem", subtitle: seriesSubtitle(series) };
  }

  return { ...base, type: "simpleCarouselItem", subtitle: seriesSubtitle(series) };
}

export class MangaBakaExtension
  implements
    Extension,
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
    this.mainInterceptor.registerInterceptor();
  }

  async getSettingsForm(): Promise<Form> {
    return new SettingsForm();
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
    let tagOptions: TagOption[] = [];
    try {
      tagOptions = await getTagOptions();
    } catch {
      // The rest of the filters are worth offering on their own.
    }

    return new SearchFiltersForm(readFilters(query), tagOptions);
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
    // Genres and tags are the same thing to the endpoint, so the two rows
    // collapse back into one pair of parameters here.
    const includedTags = [...(filters.genres ?? []), ...(filters.tags ?? [])];
    appendAll(params, "tag", includedTags);
    appendAll(params, "tag_not", [
      ...(filters.excludeGenres ?? []),
      ...(filters.excludeTags ?? []),
    ]);
    if (filters.tagMode && includedTags.length > 1) {
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
      items: (response.data ?? []).map(toSearchResultItem),
      metadata: response.pagination?.next && page < SEARCH_MAX_PAGE ? page + 1 : undefined,
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    // Called without parameters so the response stays cacheable; these
    // endpoints return a fixed-size list and do not paginate.
    const response = await makeRequest<Envelope<Series[]>>(`/v2/series/discover/${section.id}`);

    return {
      items: (response.data ?? []).map((series) => toDiscoverItem(series, section.type)),
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

    // Collapse the queue so each series is written once, at its furthest point.
    const furthest = new Map<string, { chapter: number; volume: number }>();
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
      });
    }

    for (const [seriesId, progress] of furthest) {
      const ids = actions
        .filter((action) => action.sourceManga.mangaId === seriesId)
        .map((action) => action.id);

      try {
        let exists = true;
        let current = 0;
        try {
          const response = await makeRequest<Envelope<LibraryEntry>>(`/v1/my/library/${seriesId}`, {
            needsAuth: true,
          });
          current = response.data.progress_chapter ?? 0;
        } catch (error) {
          if (!(error instanceof MangaBakaError) || error.status !== 404) throw error;
          exists = false;
        }

        // Never move progress backwards.
        if (exists && current >= progress.chapter) {
          result.successfulItems.push(...ids);
          continue;
        }

        const body: Record<string, unknown> = { progress_chapter: progress.chapter };
        if (progress.volume >= 0) {
          body.progress_volume = progress.volume;
        }
        if (!exists) {
          body.state = "reading";
        }

        await makeRequest(`/v1/my/library/${seriesId}`, {
          method: exists ? "PATCH" : "POST",
          needsAuth: true,
          body,
        });

        result.successfulItems.push(...ids);
      } catch (error) {
        // A rate limit, an outage or an expired credential is not a write that
        // failed, it is one that never happened. Reporting those would count
        // an error against actions that deserve another attempt.
        if (!shouldRetryLater(error)) {
          result.failedItems.push(...ids);
        }
      }
    }

    return result;
  }
}

export const MangaBaka = new MangaBakaExtension();
