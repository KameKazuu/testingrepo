/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type {
  PagedResults,
  Request,
  SearchQuery,
  SearchResultItem,
  SortingOption,
} from "@paperback/types";
import { CloudflareError, URL } from "@paperback/types";
import {
  SearchFilterForm,
  type SearchFilter,
  type SearchFilterValue,
} from "@paperback/types/lib/compat/0.8";

import {
  apiHeaders,
  fetchJSON,
  getKaganeMetadata,
  getKaganeTagEntries,
  getKaganeTags,
} from "../../services/network";
import {
  getContentLanguages,
  getContentRatingSetting,
  getCustomHiddenTags,
  getExcludedGenres,
  getHiddenFormats,
  getHiddenTagCategoryIds,
  getShowSource,
  getSourceDisplayMode,
} from "../settings-form/main";
import {
  API_URL,
  FORMAT_OPTIONS,
  PAGE_SIZE,
  RANGE_OPTIONS,
  SORTING_OPTIONS,
  type KaganeSearchSeries,
  type KaganeSearchResponse,
} from "../shared/models";
import { buildImageUrl, getContentRatingValues, mapItemContentRating } from "../shared/utils";
import {
  buildSearchFilters,
  parseTagInput,
  readDropdownFilter,
  readInputFilter,
  readMultiselectFilter,
} from "./parsers";

export class SearchProvider {
  async getSearchFilters(): Promise<SearchFilter[]> {
    const metadata = await getKaganeMetadata();
    // The full tag taxonomy renders as a browsable multiselect. If it can't be
    // fetched, the sheet still opens — typed tags keep working via the input.
    // A Cloudflare challenge must surface so the app can raise the bypass.
    let tagOptions: Array<{ id: string; value: string }> = [];
    try {
      tagOptions = (await getKaganeTagEntries())
        .map((tag) => ({ id: tag.id, value: tag.tag_name }))
        .sort((left, right) => left.value.localeCompare(right.value));
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      console.log(`[Kagane] tag taxonomy unavailable for filters: ${String(error)}`);
      tagOptions = [];
    }
    return buildSearchFilters(metadata, getSourceDisplayMode(), tagOptions);
  }

  getAdvancedSearchForm(query: SearchQuery<SearchFilterValue[]>) {
    return new SearchFilterForm(query.metadata, this.getSearchFilters());
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getSearchResults(
    query: SearchQuery<SearchFilterValue[]>,
    metadata?: { page?: number },
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const kaganeMetadata = await getKaganeMetadata();
    const searchBody = await buildSearchBody(query);
    // A "range" filter (from the Trending discover chips) carries the trending
    // window whose sort to apply; otherwise use the reader's sorting option.
    const rangeEntry = (query.metadata ?? []).find((filter) => filter.id === "range");
    const rangeSort =
      typeof rangeEntry?.value === "string"
        ? RANGE_OPTIONS.find((range) => range.id === rangeEntry.value)?.sort
        : undefined;
    const sort = rangeSort ?? sortingOption?.id ?? "relevance";

    const url = new URL(API_URL)
      .addPathComponent("api")
      .addPathComponent("v2")
      .addPathComponent("search")
      .addPathComponent("series")
      .setQueryItem("page", String(page - 1))
      .setQueryItem("size", String(PAGE_SIZE));

    if (sort !== "relevance") {
      url.setQueryItem("sort", sort);
    }

    const request: Request = {
      url: url.toString(),
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify(searchBody),
    };

    const data = await fetchJSON<KaganeSearchResponse>(request);
    const sourceMap = new Map(
      kaganeMetadata.sources.map((source) => [source.source_id, source.title]),
    );
    const showSource = getShowSource();

    const items = (data.content ?? []).map((book) => mapSearchResult(book, sourceMap, showSource));

    return {
      items,
      metadata: data.last === false && items.length > 0 ? { page: page + 1 } : undefined,
    };
  }
}

export async function buildSearchBody(
  query: SearchQuery<SearchFilterValue[]>,
): Promise<Record<string, unknown>> {
  const filters = query.metadata ?? [];
  // Per-search filter selections override the corresponding settings.
  const displayMode = getSourceDisplayMode();
  const sourceTypes = readMultiselectFilter(filters, "source_types");
  const languages = readMultiselectFilter(filters, "languages");
  const body: Record<string, unknown> = {
    source_type:
      sourceTypes.length > 0
        ? sourceTypes
        : displayMode === "official"
          ? ["Official"]
          : displayMode === "scanlations"
            ? ["Unofficial", "Mixed"]
            : ["Official", "Unofficial", "Mixed"],
    content_rating: getContentRatingValues(getContentRatingSetting()),
    content_lang: languages.length > 0 ? languages : getContentLanguages(),
  };

  const title = query.title?.trim();
  if (title) {
    body.title = title;
  }

  const yearFrom = Number.parseInt(readInputFilter(filters, "year_from"), 10);
  const yearTo = Number.parseInt(readInputFilter(filters, "year_to"), 10);
  if (Number.isFinite(yearFrom) || Number.isFinite(yearTo)) {
    body.start_year = {
      ...(Number.isFinite(yearFrom) ? { min: yearFrom } : {}),
      ...(Number.isFinite(yearTo) ? { max: yearTo } : {}),
    };
  }

  // An explicit Format search filter wins; otherwise apply the hide-list by
  // sending every format that is not hidden.
  const formats = readMultiselectFilter(filters, "formats");
  const hiddenFormats = getHiddenFormats();
  if (formats.length > 0) {
    body.format = formats;
  } else if (hiddenFormats.length > 0) {
    body.format = FORMAT_OPTIONS.filter((format) => !hiddenFormats.includes(format));
  }

  const statuses = readMultiselectFilter(filters, "statuses");
  if (statuses.length > 0) {
    body.upload_status = statuses;
  }

  const sources = readMultiselectFilter(filters, "sources");
  if (sources.length > 0) {
    body.source_id = sources;
  }

  const includedGenres = readMultiselectFilter(filters, "genres");
  const excludedGenres = [
    ...readMultiselectFilter(filters, "genres", "excluded"),
    ...getExcludedGenres(),
  ];
  if (includedGenres.length > 0 || excludedGenres.length > 0) {
    body.genres = buildCompoundFilter(
      includedGenres,
      excludedGenres,
      readDropdownFilter(filters, "genres_match_all", "true") === "true",
    );
  }

  // Tags come from several places: the browsable multiselect (UUIDs, both
  // states), the typed input's "-tag" entries, the preset hide-categories
  // (already UUIDs), and the custom hidden tag names. Names are resolved
  // through the taxonomy (case-insensitive) — fetched lazily only when names
  // are present.
  const tags = parseTagInput(readInputFilter(filters, "tags_text"));
  const customHiddenNames = getCustomHiddenTags();
  const includedTags = [...readMultiselectFilter(filters, "tags")];
  const excludedTags = [
    ...readMultiselectFilter(filters, "tags", "excluded"),
    ...getHiddenTagCategoryIds(),
  ];
  if (tags.included.length > 0 || tags.excluded.length > 0 || customHiddenNames.length > 0) {
    const tagIds = await getKaganeTags();
    includedTags.push(...resolveTagIds(tags.included, tagIds));
    excludedTags.push(
      ...resolveTagIds(tags.excluded, tagIds),
      ...resolveTagIds(customHiddenNames, tagIds),
    );
  }
  if (includedTags.length > 0 || excludedTags.length > 0) {
    body.tags = buildCompoundFilter(
      includedTags,
      excludedTags,
      readDropdownFilter(filters, "tags_match_all", "true") === "true",
    );
  }

  return body;
}

function resolveTagIds(names: string[], tagIds: Record<string, string>): string[] {
  return names.map((name) => tagIds[name.toLowerCase()]).filter((id): id is string => Boolean(id));
}

function buildCompoundFilter(
  included: string[],
  excluded: string[],
  matchAll: boolean,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    values: included,
  };

  if (matchAll) {
    filter.match_all = true;
  }
  if (excluded.length > 0) {
    filter.exclude = [...new Set(excluded)];
  }

  return filter;
}

function mapSearchResult(
  book: KaganeSearchSeries,
  sources: Map<string, string>,
  showSource: boolean,
): SearchResultItem {
  const sourceName = book.source_id ? sources.get(book.source_id) : undefined;
  const title =
    showSource && sourceName ? `${book.title.trim()} [${sourceName}]` : book.title.trim();
  const subtitles = [
    typeof book.current_books === "number" ? `${book.current_books} Chapters` : undefined,
    book.start_year ? String(book.start_year) : undefined,
  ].filter((value): value is string => Boolean(value));

  return {
    mangaId: book.series_id,
    title,
    imageUrl: buildImageUrl(book.cover_image_id),
    subtitle: subtitles.join(" - "),
    contentRating: mapItemContentRating(book.content_rating),
  };
}
