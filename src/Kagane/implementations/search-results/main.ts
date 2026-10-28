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
import type { SearchFilter, SearchFilterValue } from "@paperback/types/lib/compat/0.8";

import {
  apiHeaders,
  resolvePersonOrGroup,
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
  getHideDisturbing,
  getSourceDisplayMode,
} from "../settings-form/main";
import {
  FORMAT_OPTIONS,
  CONTENT_RATING_OPTIONS,
  type KaganeSearchMetadata,
  type KaganeSeriesDetailsResponse,
  LANGUAGE_OPTIONS,
  PAGE_SIZE,
  POPULAR_TAG_NAMES,
  PUBLICATION_STATUS_OPTIONS,
  RANGE_OPTIONS,
  SORTING_OPTIONS,
  SOURCE_TYPE_OPTIONS,
  type KaganeSearchSeries,
  type KaganeSearchResponse,
} from "../shared/models";
import { getBaseUrl, parseSeriesUrl } from "../shared/parsers";
import { buildImageUrl, isKaganeRatingAllowed, mapItemContentRating } from "../shared/utils";
import { KaganeAdvancedSearchForm } from "./forms";
import { getVisibleSources, parseTagInput, normalizeMetadata, parseRange } from "./parsers";

export class SearchProvider {
  async getSearchFilters(): Promise<SearchFilter[]> {
    const metadata = await getKaganeMetadata();

    // The tag multiselect shows the curated well-known set — rendering all
    // ~8k taxonomy entries freezes the app — while the typed input reaches
    // everything. If the taxonomy can't be fetched, the sheet still opens.
    // A Cloudflare challenge must surface so the app can raise the bypass.
    let tagOptions: Array<{ id: string; value: string }> = [];
    try {
      const popular = new Set(POPULAR_TAG_NAMES.map((name) => name.toLowerCase()));
      tagOptions = (await getKaganeTagEntries())
        .filter((tag) => popular.has(tag.tag_name.toLowerCase()))
        .map((tag) => ({ id: tag.id, value: tag.tag_name }))
        .sort((left, right) => left.value.localeCompare(right.value));
    } catch (error) {
      if (error instanceof CloudflareError) throw error;
      console.log(`[Kagane] tag taxonomy unavailable for filters: ${String(error)}`);
      tagOptions = [];
    }

    return [
      {
        type: "multiselect",
        id: "formats",
        title: "Format",
        options: FORMAT_OPTIONS.map((format) => ({ id: format, value: format })),
        value: {},
        allowExclusion: false,
        allowEmptySelection: true,
        maximum: undefined,
      },
      {
        type: "multiselect",
        id: "statuses",
        title: "Upload Status",
        options: PUBLICATION_STATUS_OPTIONS,
        value: {},
        allowExclusion: false,
        allowEmptySelection: true,
        maximum: undefined,
      },
      {
        type: "multiselect",
        id: "publication_statuses",
        title: "Publication Status",
        options: PUBLICATION_STATUS_OPTIONS,
        value: {},
        allowExclusion: false,
        allowEmptySelection: true,
        maximum: undefined,
      },
      {
        type: "multiselect",
        id: "ratings",
        title: "Content Ratings (This Search)",
        options: CONTENT_RATING_OPTIONS.map(({ id, title }) => ({ id, value: title })),
        value: {},
        allowExclusion: false,
        allowEmptySelection: true,
        maximum: undefined,
      },
      {
        type: "dropdown",
        id: "disturbing",
        title: "Disturbing Content (This Search)",
        options: [
          { id: "default", value: "Use Setting" },
          { id: "exclude", value: "Hide" },
          { id: "include", value: "Include" },
          { id: "only", value: "Only Disturbing" },
        ],
        value: "default",
      },
      {
        type: "input",
        id: "creator",
        title: "Author / Artist",
        placeholder: "Full name or staff ID",
        value: "",
      },
      {
        type: "input",
        id: "group",
        title: "Scanlation Group",
        placeholder: "Full name or group ID",
        value: "",
      },
      {
        type: "input",
        id: "chapters_from",
        title: "Minimum Chapters",
        placeholder: "e.g. 10",
        value: "",
      },
      {
        type: "input",
        id: "chapters_to",
        title: "Maximum Chapters",
        placeholder: "e.g. 100",
        value: "",
      },
      {
        type: "multiselect",
        id: "languages",
        title: "Language",
        options: LANGUAGE_OPTIONS.map((language) => ({
          id: language.id,
          value: language.title,
        })),
        value: {},
        allowExclusion: false,
        allowEmptySelection: true,
        maximum: undefined,
      },
      {
        type: "multiselect",
        id: "source_types",
        title: "Source Type",
        options: SOURCE_TYPE_OPTIONS.map((type) => ({ id: type, value: type })),
        value: {},
        allowExclusion: false,
        allowEmptySelection: true,
        maximum: undefined,
      },
      {
        type: "multiselect",
        id: "genres",
        title: "Genres",
        options: Object.entries(metadata.genres)
          .sort(([, left], [, right]) => left.localeCompare(right))
          .map(([id, value]) => ({ id, value })),
        value: {},
        allowExclusion: true,
        allowEmptySelection: true,
        maximum: undefined,
      },
      {
        type: "dropdown",
        id: "genres_match_all",
        title: "Genre Matching",
        options: [
          { id: "true", value: "Match All Selected Genres" },
          { id: "false", value: "Match Any Selected Genre" },
        ],
        value: "true",
      },
      ...(tagOptions.length > 0
        ? ([
            {
              type: "multiselect",
              id: "tags",
              title: "Tags",
              options: tagOptions,
              value: {},
              allowExclusion: true,
              allowEmptySelection: true,
              maximum: undefined,
            },
          ] satisfies SearchFilter[])
        : []),
      {
        type: "input",
        id: "tags_text",
        title: "Tags (typed)",
        placeholder: "romance, -gore",
        value: "",
      },
      {
        type: "dropdown",
        id: "tags_match_all",
        title: "Tag Matching",
        options: [
          { id: "true", value: "Match All Selected Tags" },
          { id: "false", value: "Match Any Selected Tag" },
        ],
        value: "true",
      },
      {
        type: "multiselect",
        id: "sources",
        title: "Sources",
        options: getVisibleSources(metadata.sources, getSourceDisplayMode())
          .sort((left, right) => left.title.localeCompare(right.title))
          .map((source) => ({ id: source.source_id, value: source.title })),
        value: {},
        allowExclusion: false,
        allowEmptySelection: true,
        maximum: undefined,
      },
      {
        type: "input",
        id: "year_from",
        title: "Release Year From",
        placeholder: "e.g. 2018",
        value: "",
      },
      {
        type: "input",
        id: "year_to",
        title: "Release Year To",
        placeholder: "e.g. 2024",
        value: "",
      },
    ];
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchFilterValue[] | KaganeSearchMetadata>) {
    return new KaganeAdvancedSearchForm(
      normalizeMetadata(query.metadata),
      await this.getSearchFilters(),
    );
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORTING_OPTIONS;
  }

  async getSearchResults(
    query: SearchQuery<SearchFilterValue[] | KaganeSearchMetadata>,
    metadata?: { page?: number },
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const kaganeMetadata = await getKaganeMetadata();
    const meta = normalizeMetadata(query.metadata);
    const directId = parseSeriesUrl(query.title?.trim() ?? "");
    if (directId && page === 1) {
      try {
        const detail = await fetchJSON<KaganeSeriesDetailsResponse>({
          url: new URL(getBaseUrl())
            .addPathComponent("api/v2/series")
            .addPathComponent(directId)
            .toString(),
          method: "GET",
          headers: apiHeaders(),
        });
        if (detail.title && detail.series_covers?.[0]?.image_id) {
          const sourceMap = new Map(
            kaganeMetadata.sources.map((source) => [source.source_id, source.title]),
          );
          const item = mapSearchResult(
            {
              ...detail,
              series_id: directId,
              cover_image_id: detail.series_covers[0].image_id,
              genres: detail.genres?.flatMap((genre) => (genre.genre_id ? [genre.genre_id] : [])),
              tags: detail.tags?.flatMap((tag) => (tag.tag_id ? [tag.tag_id] : [])),
            },
            sourceMap,
            getShowSource(),
          );
          return { items: item ? [item] : [] };
        }
      } catch (error) {
        if (error instanceof CloudflareError) throw error;
        // An unresolved pasted link falls through to ordinary text search.
      }
    }
    const searchBody = await buildSearchBody(query.title, meta);
    // A trending chip carries the window whose sort to apply; otherwise use
    // the reader's sorting option.
    const rangeSort = RANGE_OPTIONS.find((range) => range.id === meta.range)?.sort;
    const sort =
      rangeSort ?? sortingOption?.id ?? (query.title?.trim() ? "relevance" : "total_views,desc");

    const url = new URL(getBaseUrl())
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

    const items = (data.content ?? [])
      .filter((book) =>
        isKaganeRatingAllowed(
          book,
          meta.ratings?.length ? meta.ratings : getContentRatingSelections(),
        ),
      )
      .map((book) => mapSearchResult(book, sourceMap, showSource))
      .filter((item): item is SearchResultItem => item != undefined);

    return {
      items,
      metadata: data.last === false ? { page: page + 1 } : undefined,
    };
  }
}

// Translate the 0.8-compat filter array (or an already-normalized object from
// a saved query) into the internal metadata shape.
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
  const ratings = meta.ratings?.length ? meta.ratings : getContentRatingSelections();
  const ageRatings = [
    ...new Set(
      ratings.map((rating) =>
        rating === "safe" ? "Safe" : rating === "suggestive" ? "FifteenPlus" : "EighteenPlus",
      ),
    ),
  ];
  const body: Record<string, unknown> = {
    age_rating: ageRatings,
    ...(ratings.includes("pornographic")
      ? ratings.length === 1
        ? { is_pornographic: true }
        : {}
      : { is_pornographic: false }),
    source_type:
      sourceTypes.length > 0
        ? sourceTypes
        : displayMode === "official"
          ? ["Official"]
          : displayMode === "scanlations"
            ? ["Unofficial", "Mixed"]
            : ["Official", "Unofficial", "Mixed"],
    content_lang: languages.length > 0 ? languages : getContentLanguages(),
  };

  const trimmedTitle = title?.trim();
  if (trimmedTitle) {
    body.title = trimmedTitle;
  }

  const yearRange = parseRange(meta.yearFrom, meta.yearTo, "Release year");
  if (yearRange) body.start_year = yearRange;
  const chapterRange = parseRange(meta.chaptersFrom, meta.chaptersTo, "Chapter count");
  if (chapterRange) body.current_books = chapterRange;
  if (meta.publicationStatuses?.length) body.publication_status = meta.publicationStatuses;
  if (meta.disturbing === "only") body.is_disturbing = true;
  else if (meta.disturbing === "exclude" || (meta.disturbing !== "include" && getHideDisturbing()))
    body.is_disturbing = false;
  if (meta.creator?.trim())
    body.staff = { values: [await resolvePersonOrGroup("staff", meta.creator.trim())] };
  if (meta.group?.trim())
    body.groups = { values: [await resolvePersonOrGroup("groups", meta.group.trim())] };

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
    if (sources.length > 50) throw new Error("Kagane allows at most 50 sources.");
    body.source_id = sources;
  }

  const includedGenres = pickTriState(meta.genres, "included");
  const excludedGenres = [...pickTriState(meta.genres, "excluded"), ...getExcludedGenres()];
  if (includedGenres.length > 0 || excludedGenres.length > 0) {
    body.genres = buildCompoundFilter(includedGenres, excludedGenres, meta.genresMatchAll ?? true);
  }

  // Tags come from several places: the tri-state multiselect (UUIDs, both
  // states), the typed input's "-tag" entries, the preset hide-categories
  // (already UUIDs), and the custom hidden tag names. Names are resolved
  // through the taxonomy (case-insensitive) — fetched lazily only when names
  // are present.
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
    body.tags = buildCompoundFilter(includedTags, excludedTags, meta.tagsMatchAll ?? true);
  }

  return body;
}

function resolveTagIds(names: string[], tagIds: Record<string, string>): string[] {
  const unknown = names.filter((name) => !tagIds[name.toLowerCase()]);
  if (unknown.length)
    throw new Error(
      `Unknown Kagane tag${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Enter exact tag names.`,
    );
  return names.map((name) => tagIds[name.toLowerCase()]);
}

function buildCompoundFilter(
  included: string[],
  excluded: string[],
  matchAll: boolean,
): Record<string, unknown> {
  if (included.length > 50 || excluded.length > 50) {
    throw new Error("Kagane allows at most 50 selected or excluded IDs per filter.");
  }
  const filter: Record<string, unknown> = {
    values: [...new Set(included)],
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
): SearchResultItem | undefined {
  const coverImageId = book.cover_image_id?.trim();
  if (!coverImageId) return undefined;

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
    imageUrl: buildImageUrl(coverImageId),
    subtitle: subtitles.join(" - "),
    contentRating: mapItemContentRating(book.content_rating, book.age_rating, book.is_pornographic),
  };
}
