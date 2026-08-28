/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  type Metadata,
  Section,
  SelectRow,
  ToggleRow,
  TriStateSelectRow,
} from "@paperback/types";

import {
  CONTENT_RATINGS,
  type SearchFilters,
  SERIES_STATUSES,
  SERIES_TYPES,
  TAG_MODES,
} from "../models";

type TriState = Record<string, "included" | "excluded">;

// Metadata keeps include/exclude as two id arrays, which is the shape the
// search endpoint's paired parameters want; the tri-state rows edit them as
// one record.
const toTriState = (included?: string[], excluded?: string[]): TriState => {
  const record: TriState = {};
  for (const id of included ?? []) record[id] = "included";
  for (const id of excluded ?? []) record[id] = "excluded";
  return record;
};

const pickState = (record: TriState, state: "included" | "excluded"): string[] =>
  Object.keys(record).filter((id) => record[id] === state);

export class SearchFiltersForm extends AdvancedSearchForm {
  private readonly genreItems: { id: string; title: string }[];
  private genres: TriState;
  private tagMode: string;
  private types: TriState;
  private statuses: TriState;
  private contentRatings: TriState;
  private licensedOnly: boolean;

  constructor(filters: SearchFilters, genreOptions: { id: string; title: string }[]) {
    super();
    this.genreItems = genreOptions;
    this.genres = toTriState(filters.genres, filters.excludeGenres);
    this.tagMode = filters.tagMode ?? "and";
    this.types = toTriState(filters.types, filters.excludeTypes);
    this.statuses = toTriState(filters.statuses, filters.excludeStatuses);
    this.contentRatings = toTriState(filters.contentRatings, filters.excludeContentRatings);
    this.licensedOnly = filters.licensedOnly ?? false;
  }

  override getSections() {
    return [
      // The list is empty when the genre vocabulary could not be fetched, and
      // an empty row is worse than no row.
      Section({ id: "genre", footer: "Tap once to require a genre, twice to exclude it." }, [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreItems,
          allowExclusion: true,
          allowEmptySelection: true,
          isHidden: this.genreItems.length === 0,
          onValueChange: Application.Selector(this as SearchFiltersForm, "handleGenresChange"),
        }),
        SelectRow("tagMode", {
          title: "Match",
          subtitle: "How required genres are combined",
          value: [this.tagMode],
          layout: "list",
          items: TAG_MODES,
          minItemCount: 1,
          maxItemCount: 1,
          isHidden: this.genreItems.length === 0,
          onValueChange: Application.Selector(this as SearchFiltersForm, "handleTagModeChange"),
        }),
      ]),
      Section({ id: "type", footer: "Tap once to require a type, twice to exclude it." }, [
        TriStateSelectRow("types", {
          title: "Type",
          layout: "flow",
          value: this.types,
          items: SERIES_TYPES,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(this as SearchFiltersForm, "handleTypesChange"),
        }),
      ]),
      Section({ id: "status", footer: "Tap once to require a status, twice to exclude it." }, [
        TriStateSelectRow("statuses", {
          title: "Status",
          layout: "flow",
          value: this.statuses,
          items: SERIES_STATUSES,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(this as SearchFiltersForm, "handleStatusesChange"),
        }),
      ]),
      Section({ id: "rating", footer: "Tap once to require a rating, twice to exclude it." }, [
        TriStateSelectRow("contentRatings", {
          title: "Content Rating",
          layout: "flow",
          value: this.contentRatings,
          items: CONTENT_RATINGS,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as SearchFiltersForm,
            "handleContentRatingsChange",
          ),
        }),
      ]),
      Section("licensing", [
        ToggleRow("licensedOnly", {
          title: "Officially Licensed Only",
          value: this.licensedOnly,
          onValueChange: Application.Selector(
            this as SearchFiltersForm,
            "handleLicensedOnlyChange",
          ),
        }),
      ]),
    ];
  }

  // A tri-state row renders its parent-side summary once, when the section is
  // built, so the form has to be rebuilt for the new selection to show.
  async handleGenresChange(value: TriState): Promise<void> {
    this.genres = value;
    this.reloadForm();
  }

  async handleTagModeChange(value: string[]): Promise<void> {
    this.tagMode = value[0] ?? "and";
    this.reloadForm();
  }

  async handleTypesChange(value: TriState): Promise<void> {
    this.types = value;
    this.reloadForm();
  }

  async handleStatusesChange(value: TriState): Promise<void> {
    this.statuses = value;
    this.reloadForm();
  }

  async handleContentRatingsChange(value: TriState): Promise<void> {
    this.contentRatings = value;
    this.reloadForm();
  }

  async handleLicensedOnlyChange(value: boolean): Promise<void> {
    this.licensedOnly = value;
  }

  override getSearchQueryMetadata(): Metadata {
    const filters: SearchFilters = {};
    const assign = (key: keyof SearchFilters, ids: string[]): void => {
      if (ids.length > 0) {
        (filters[key] as string[]) = ids;
      }
    };

    assign("genres", pickState(this.genres, "included"));
    assign("excludeGenres", pickState(this.genres, "excluded"));
    if (this.tagMode !== "and") filters.tagMode = this.tagMode;
    assign("types", pickState(this.types, "included"));
    assign("excludeTypes", pickState(this.types, "excluded"));
    assign("statuses", pickState(this.statuses, "included"));
    assign("excludeStatuses", pickState(this.statuses, "excluded"));
    assign("contentRatings", pickState(this.contentRatings, "included"));
    assign("excludeContentRatings", pickState(this.contentRatings, "excluded"));
    if (this.licensedOnly) filters.licensedOnly = true;

    return filters;
  }
}
