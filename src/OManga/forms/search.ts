/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  ToggleRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  AGE_RATING_OPTIONS,
  GENRE_OPTIONS,
  MIN_RATING_OPTIONS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  YEAR_OPTIONS,
  type OptionItem,
} from "../models";
import type { SearchMetadata } from "../models";

const toTags = (options: OptionItem[]): Tag[] =>
  options.map((option) => ({ id: option.id, title: option.value }));

const GENRE_TAGS = toTags(GENRE_OPTIONS);
const TYPE_TAGS = toTags(TYPE_OPTIONS);
const STATUS_TAGS = toTags(STATUS_OPTIONS);
const AGE_RATING_TAGS = toTags(AGE_RATING_OPTIONS);
const MIN_RATING_TAGS = toTags(MIN_RATING_OPTIONS);
const YEAR_TAGS = toTags(YEAR_OPTIONS);

// The site's filter drawer, one to one: Genres (with the strict-match toggle),
// Type, Status, Age Rating, minimum Rating, Release Year, a chapter-count
// range, excluded Genres, and a free-text tag.
export class OMangaAdvancedSearchForm extends AdvancedSearchForm {
  private genres: string[];
  private excludeGenres: string[];
  private genreStrict: boolean;
  private types: string[];
  private statuses: string[];
  private ageRatings: string[];
  private minRating: string;
  private years: string[];
  private chaptersFrom: string;
  private chaptersTo: string;
  private tag: string;

  constructor(searchQuery: SearchQuery<SearchMetadata>) {
    super();
    const meta = searchQuery.metadata ?? {};
    this.genres = meta.genres ?? [];
    this.excludeGenres = meta.excludeGenres ?? [];
    this.genreStrict = meta.genreStrict ?? false;
    this.types = meta.types ?? [];
    this.statuses = meta.statuses ?? [];
    this.ageRatings = meta.ageRatings ?? [];
    this.minRating = meta.minRating ?? "";
    this.years = meta.years ?? [];
    this.chaptersFrom = meta.chaptersFrom ?? "";
    this.chaptersTo = meta.chaptersTo ?? "";
    this.tag = meta.tag ?? "";
  }

  override getSections() {
    return [
      Section("genres", [
        SelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          options: GENRE_TAGS,
          minItemCount: 0,
          maxItemCount: GENRE_TAGS.length,
          onValueChange: Application.Selector(
            this as OMangaAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
        ToggleRow("genre_strict", {
          title: "Match All Genres",
          value: this.genreStrict,
          onValueChange: Application.Selector(
            this as OMangaAdvancedSearchForm,
            "handleGenreStrictChange",
          ),
        }),
      ]),
      Section("exclude_genres", [
        SelectRow("exclude_genres", {
          title: "Exclude Genres",
          layout: "flow",
          value: this.excludeGenres,
          options: GENRE_TAGS,
          minItemCount: 0,
          maxItemCount: GENRE_TAGS.length,
          onValueChange: Application.Selector(
            this as OMangaAdvancedSearchForm,
            "handleExcludeGenresChange",
          ),
        }),
      ]),
      Section("types", [
        SelectRow("types", {
          title: "Type",
          layout: "flow",
          value: this.types,
          options: TYPE_TAGS,
          minItemCount: 0,
          maxItemCount: TYPE_TAGS.length,
          onValueChange: Application.Selector(
            this as OMangaAdvancedSearchForm,
            "handleTypesChange",
          ),
        }),
      ]),
      Section("statuses", [
        SelectRow("statuses", {
          title: "Status",
          layout: "flow",
          value: this.statuses,
          options: STATUS_TAGS,
          minItemCount: 0,
          maxItemCount: STATUS_TAGS.length,
          onValueChange: Application.Selector(
            this as OMangaAdvancedSearchForm,
            "handleStatusesChange",
          ),
        }),
      ]),
      Section("age_ratings", [
        SelectRow("age_ratings", {
          title: "Age Rating",
          layout: "flow",
          value: this.ageRatings,
          options: AGE_RATING_TAGS,
          minItemCount: 0,
          maxItemCount: AGE_RATING_TAGS.length,
          onValueChange: Application.Selector(
            this as OMangaAdvancedSearchForm,
            "handleAgeRatingsChange",
          ),
        }),
      ]),
      Section("min_rating", [
        SelectRow("min_rating", {
          title: "Rating",
          layout: "flow",
          value: this.minRating ? [this.minRating] : [],
          options: MIN_RATING_TAGS,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as OMangaAdvancedSearchForm,
            "handleMinRatingChange",
          ),
        }),
      ]),
      Section("years", [
        SelectRow("years", {
          title: "Release Year",
          layout: "flow",
          value: this.years,
          options: YEAR_TAGS,
          minItemCount: 0,
          maxItemCount: YEAR_TAGS.length,
          onValueChange: Application.Selector(
            this as OMangaAdvancedSearchForm,
            "handleYearsChange",
          ),
        }),
      ]),
      Section({ id: "chapter_range", footer: "Number of chapters, e.g. 20 to 100." }, [
        InputRow("chapters_from", {
          title: "Chapters From",
          value: this.chaptersFrom,
          onValueChange: Application.Selector(
            this as OMangaAdvancedSearchForm,
            "handleChaptersFromChange",
          ),
        }),
        InputRow("chapters_to", {
          title: "Chapters To",
          value: this.chaptersTo,
          onValueChange: Application.Selector(
            this as OMangaAdvancedSearchForm,
            "handleChaptersToChange",
          ),
        }),
      ]),
      Section({ id: "tag", footer: "A single site tag, e.g. Regression or Time Travel." }, [
        InputRow("tag", {
          title: "Tag",
          value: this.tag,
          onValueChange: Application.Selector(this as OMangaAdvancedSearchForm, "handleTagChange"),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: string[]): Promise<void> {
    this.genres = value;
  }

  async handleExcludeGenresChange(value: string[]): Promise<void> {
    this.excludeGenres = value;
  }

  async handleGenreStrictChange(value: boolean): Promise<void> {
    this.genreStrict = value;
  }

  async handleTypesChange(value: string[]): Promise<void> {
    this.types = value;
  }

  async handleStatusesChange(value: string[]): Promise<void> {
    this.statuses = value;
  }

  async handleAgeRatingsChange(value: string[]): Promise<void> {
    this.ageRatings = value;
  }

  async handleMinRatingChange(value: string[]): Promise<void> {
    this.minRating = value[0] ?? "";
  }

  async handleYearsChange(value: string[]): Promise<void> {
    this.years = value;
  }

  async handleChaptersFromChange(value: string): Promise<void> {
    this.chaptersFrom = value.trim();
  }

  async handleChaptersToChange(value: string): Promise<void> {
    this.chaptersTo = value.trim();
  }

  async handleTagChange(value: string): Promise<void> {
    this.tag = value.trim();
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.genres.length > 0) result.genres = this.genres;
    if (this.excludeGenres.length > 0) result.excludeGenres = this.excludeGenres;
    if (this.genreStrict) result.genreStrict = true;
    if (this.types.length > 0) result.types = this.types;
    if (this.statuses.length > 0) result.statuses = this.statuses;
    if (this.ageRatings.length > 0) result.ageRatings = this.ageRatings;
    if (this.minRating.length > 0) result.minRating = this.minRating;
    if (this.years.length > 0) result.years = this.years;
    if (this.chaptersFrom.length > 0) result.chaptersFrom = this.chaptersFrom;
    if (this.chaptersTo.length > 0) result.chaptersTo = this.chaptersTo;
    if (this.tag.length > 0) result.tag = this.tag;
    return result;
  }
}
