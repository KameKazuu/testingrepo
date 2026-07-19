/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type {
  PagedResults,
  Request,
  SearchQuery,
  SearchResultItem,
  SortingOption,
} from "@paperback/types";
import { URL } from "@paperback/types";
import {
  SearchFilterForm,
  type SearchFilter,
  type SearchFilterValue,
} from "@paperback/types/lib/compat/0.8";

import { apiHeaders, fetchJSON, getKaganeMetadata, getKaganeTags } from "../../services/network";
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
    return buildSearchFilters(metadata, getSourceDisplayMode());
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
    // A "range" filter (from the Trending discover chips) carries the sort to
    // apply; otherwise use the reader's chosen sorting option.
    const rangeEntry = (query.metadata ?? []).find((filter) => filter.id === "range");
    const sort =
      typeof rangeEntry?.value === "string" && rangeEntry.value
        ? rangeEntry.value
        : (sortingOption?.id ?? "relevance");

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
  const displayMode = getSourceDisplayMode();
  const body: Record<string, unknown> = {
    source_type:
      displayMode === "official"
        ? ["Official"]
        : displayMode === "scanlations"
          ? ["Unofficial", "Mixed"]
          : ["Official", "Unofficial", "Mixed"],
    content_rating: getContentRatingValues(getContentRatingSetting()),
    content_lang: getContentLanguages(),
  };

  const title = query.title?.trim();
  if (title) {
    body.title = title;
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

  // Excluded tags come from three places: the search input's "-tag" entries,
  // the preset hide-categories (already UUIDs), and the custom hidden tag
  // names. The search expects tag UUIDs, so names are resolved through the
  // taxonomy (case-insensitive) — fetched lazily only when names are present.
  const tags = parseTagInput(readInputFilter(filters, "tags"));
  const customHiddenNames = getCustomHiddenTags();
  let includedTags: string[] = [];
  const excludedTags = [...getHiddenTagCategoryIds()];
  if (tags.included.length > 0 || tags.excluded.length > 0 || customHiddenNames.length > 0) {
    const tagIds = await getKaganeTags();
    includedTags = resolveTagIds(tags.included, tagIds);
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
