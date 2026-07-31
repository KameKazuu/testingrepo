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
  SEARCH_LIMIT,
  SEARCH_MAX_PAGE,
  type SearchFilters,
  type Series,
  SORT_OPTIONS,
} from "./models";
import { isAuthenticated, MangaBakaInterceptor, makeRequest } from "./network";
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
    return new SearchFiltersForm(readFilters(query));
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
    appendAll(params, "type", filters.types);
    appendAll(params, "status", filters.statuses);
    appendAll(params, "content_rating", filters.contentRatings);
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
    } catch {
      // Not tracked yet, or the token is no longer valid.
      return undefined;
    }

    const chapterNumber = entry.progress_chapter ?? 0;
    const lastReadChapter: Chapter = {
      chapterId: String(chapterNumber),
      sourceManga,
      langCode: "unknown",
      chapNum: chapterNumber,
      volume: entry.progress_volume ?? undefined,
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

    if (!isAuthenticated()) {
      result.failedItems.push(...actions.map((action) => action.id));
      return result;
    }

    // Collapse the queue so each series is written once, at its highest chapter.
    const highest = new Map<string, number>();
    for (const action of actions) {
      const seriesId = action.sourceManga.mangaId;
      const chapter = Math.floor(action.chapterNum);
      if ((highest.get(seriesId) ?? -1) < chapter) {
        highest.set(seriesId, chapter);
      }
    }

    for (const [seriesId, chapter] of highest) {
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
          if (!(error instanceof Error) || !error.message.includes("[404]")) throw error;
          exists = false;
        }

        // Never move progress backwards.
        if (exists && current >= chapter) {
          result.successfulItems.push(...ids);
          continue;
        }

        await makeRequest(`/v1/my/library/${seriesId}`, {
          method: exists ? "PATCH" : "POST",
          needsAuth: true,
          body: exists
            ? { progress_chapter: chapter }
            : { state: "reading", progress_chapter: chapter },
        });

        result.successfulItems.push(...ids);
      } catch {
        result.failedItems.push(...ids);
      }
    }

    return result;
  }
}

export const MangaBaka = new MangaBakaExtension();
