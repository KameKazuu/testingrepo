/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import { GENRE_OPTIONS, STATUS_OPTIONS, TYPE_OPTIONS, type OptionItem } from "../models";
import type { SearchMetadata } from "../models";

const toTags = (options: OptionItem[]): Tag[] =>
  options.map((option) => ({ id: option.id, title: option.value }));

const GENRE_TAGS = toTags(GENRE_OPTIONS);
const TYPE_TAGS = toTags(TYPE_OPTIONS);
const STATUS_TAGS = toTags(STATUS_OPTIONS);

// The catalog filters are inclusive multi-selects passed straight through as
// query parameters, plus free-text year and tag fields.
export class OMangaAdvancedSearchForm extends AdvancedSearchForm {
  private genres: string[];
  private types: string[];
  private statuses: string[];
  private year: string;
  private tag: string;

  constructor(searchQuery: SearchQuery<SearchMetadata>) {
    super();
    const meta = searchQuery.metadata ?? {};
    this.genres = meta.genres ?? [];
    this.types = meta.types ?? [];
    this.statuses = meta.statuses ?? [];
    this.year = meta.year ?? "";
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
      Section({ id: "year", footer: "Release year, e.g. 2019." }, [
        InputRow("year", {
          title: "Year",
          value: this.year,
          onValueChange: Application.Selector(this as OMangaAdvancedSearchForm, "handleYearChange"),
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

  async handleTypesChange(value: string[]): Promise<void> {
    this.types = value;
  }

  async handleStatusesChange(value: string[]): Promise<void> {
    this.statuses = value;
  }

  async handleYearChange(value: string): Promise<void> {
    this.year = value.trim();
  }

  async handleTagChange(value: string): Promise<void> {
    this.tag = value.trim();
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.genres.length > 0) result.genres = this.genres;
    if (this.types.length > 0) result.types = this.types;
    if (this.statuses.length > 0) result.statuses = this.statuses;
    if (this.year.length > 0) result.year = this.year;
    if (this.tag.length > 0) result.tag = this.tag;
    return result;
  }
}
