/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type {
  AdvancedSearchForm,
  PagedResults,
  Request,
  SearchQuery,
  SearchResultItem,
  SortingOption,
} from "@paperback/types";
import { CloudflareError, URL } from "@paperback/types";

import {
  apiHeaders,
  fetchJSON,
  getKaganeMetadata,
  getKaganeTagEntries,
  getKaganeTags,
} from "../../services/network";
import {
  getContentLanguages,
  getContentRatingSelections,
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
import { buildImageUrl, mapItemContentRating, titleCase } from "../shared/utils";
import { KaganeAdvancedSearchForm, type FilterItem, type KaganeSearchMetadata } from "./forms";
import { getVisibleSources, parseTagInput } from "./parsers";

export class SearchProvider {
  async getAdvancedSearchForm(
    query: SearchQuery<KaganeSearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    const metadata = await getKaganeMetadata();
    const genreItems: FilterItem[] = Object.entries(metadata.genres)
      .map(([id, title]) => ({ id, title }))
      .sort((left, right) => left.title.localeCompare(right.title));
    const sourceItems: FilterItem[] = getVisibleSources(metadata.sources, getSourceDisplayMode())
      .map((source) => ({ id: source.source_id, title: source.title }))
      .sort((left, right) => left.title.localeCompare(right.title));

    // The full tag taxonomy renders as a browsable tri-state list. If it can't
    // be fetched the form still opens — typed tags keep working. A Cloudflare
    // challenge must surface so the app can raise the bypass.
    let tagItems: FilterItem[] = [];
    try {
      tagItems = (await getKaganeTagEntries())
        .map((tag) => ({ id: tag.id, title: tag.tag_name }))
        .sort((left, right) => left.title.localeCompare(right.title));
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      console.log(`[Kagane] tag taxonomy unavailable for filters: ${String(error)}`);
      tagItems = [];
    }

    return new KaganeAdvancedSearchForm(query, genreItems, tagItems, sourceItems);
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getSearchResults(
    query: SearchQuery<KaganeSearchMetadata>,
    metadata?: { page?: number },
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const kaganeMetadata = await getKaganeMetadata();
    const meta = normalizeMetadata(query.metadata);
    const searchBody = await buildSearchBody(query.title, meta);
    // A trending chip carries the window whose sort to apply; otherwise use
    // the reader's sorting option.
    const rangeSort = RANGE_OPTIONS.find((range) => range.id === meta.range)?.sort;
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

// Queries predating the native form (old discover chips, saved searches) carry
// 0.8-style filter arrays; translate the ids we ever emitted into the object
// shape so they keep working.
function normalizeMetadata(raw: KaganeSearchMetadata | undefined): KaganeSearchMetadata {
  if (Array.isArray(raw)) {
    const meta: KaganeSearchMetadata = {};
    for (const entry of raw as Array<{ id?: string; value?: unknown }>) {
      if (entry.id === "range" && typeof entry.value === "string") {
        meta.range = entry.value;
      }
      if (entry.id === "genres" && entry.value && typeof entry.value === "object") {
        meta.genres = entry.value as Record<string, "included" | "excluded">;
      }
    }
    return meta;
  }
  return raw && typeof raw === "object" ? raw : {};
}

function pickTriState(
  record: Record<string, "included" | "excluded"> | undefined,
  state: "included" | "excluded",
): string[] {
  return Object.entries(record ?? {})
    .filter(([, value]) => value === state)
    .map(([id]) => id);
}

export async function buildSearchBody(
  title: string | undefined,
  meta: KaganeSearchMetadata,
): Promise<Record<string, unknown>> {
  // Per-search selections override the corresponding settings.
  const displayMode = getSourceDisplayMode();
  const sourceTypes = meta.sourceTypes ?? [];
  const languages = meta.languages ?? [];
  const body: Record<string, unknown> = {
    source_type:
      sourceTypes.length > 0
        ? sourceTypes
        : displayMode === "official"
          ? ["Official"]
          : displayMode === "scanlations"
            ? ["Unofficial", "Mixed"]
            : ["Official", "Unofficial", "Mixed"],
    content_rating: getContentRatingSelections().map(titleCase),
    content_lang: languages.length > 0 ? languages : getContentLanguages(),
  };

  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    body.title = trimmedTitle;
  }

  const yearFrom = Number.parseInt(meta.yearFrom ?? "", 10);
  const yearTo = Number.parseInt(meta.yearTo ?? "", 10);
  if (Number.isFinite(yearFrom) || Number.isFinite(yearTo)) {
    body.start_year = {
      ...(Number.isFinite(yearFrom) ? { min: yearFrom } : {}),
      ...(Number.isFinite(yearTo) ? { max: yearTo } : {}),
    };
  }

  // An explicit Format selection wins; otherwise apply the hide-list by
  // sending every format that is not hidden.
  const formats = meta.formats ?? [];
  const hiddenFormats = getHiddenFormats();
  if (formats.length > 0) {
    body.format = formats;
  } else if (hiddenFormats.length > 0) {
    body.format = FORMAT_OPTIONS.filter((format) => !hiddenFormats.includes(format));
  }

  const statuses = meta.statuses ?? [];
  if (statuses.length > 0) {
    body.upload_status = statuses;
  }

  const sources = meta.sources ?? [];
  if (sources.length > 0) {
    body.source_id = sources;
  }

  const includedGenres = pickTriState(meta.genres, "included");
  const excludedGenres = [...pickTriState(meta.genres, "excluded"), ...getExcludedGenres()];
  if (includedGenres.length > 0 || excludedGenres.length > 0) {
    body.genres = buildCompoundFilter(
      includedGenres,
      excludedGenres,
      (meta.genresMatchAll?.[0] ?? "AND") === "AND",
    );
  }

  // Tags come from several places: the tri-state list (UUIDs, both states),
  // the typed input's "-tag" entries, the preset hide-categories (already
  // UUIDs), and the custom hidden tag names. Names are resolved through the
  // taxonomy (case-insensitive) — fetched lazily only when names are present.
  const typedTags = parseTagInput(meta.typedTags ?? "");
  const customHiddenNames = getCustomHiddenTags();
  const includedTags = pickTriState(meta.tags, "included");
  const excludedTags = [...pickTriState(meta.tags, "excluded"), ...getHiddenTagCategoryIds()];
  if (
    typedTags.included.length > 0 ||
    typedTags.excluded.length > 0 ||
    customHiddenNames.length > 0
  ) {
    const tagIds = await getKaganeTags();
    includedTags.push(...resolveTagIds(typedTags.included, tagIds));
    excludedTags.push(
      ...resolveTagIds(typedTags.excluded, tagIds),
      ...resolveTagIds(customHiddenNames, tagIds),
    );
  }
  if (includedTags.length > 0 || excludedTags.length > 0) {
    body.tags = buildCompoundFilter(
      includedTags,
      excludedTags,
      (meta.tagsMatchAll?.[0] ?? "AND") === "AND",
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
