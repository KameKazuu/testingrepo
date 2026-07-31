/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  type Metadata,
  Section,
  ToggleRow,
  TriStateSelectRow,
} from "@paperback/types";

import { CONTENT_RATINGS, type SearchFilters, SERIES_STATUSES, SERIES_TYPES } from "../models";

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
  private types: TriState;
  private statuses: TriState;
  private contentRatings: TriState;
  private licensedOnly: boolean;

  constructor(filters: SearchFilters) {
    super();
    this.types = toTriState(filters.types, filters.excludeTypes);
    this.statuses = toTriState(filters.statuses, filters.excludeStatuses);
    this.contentRatings = toTriState(filters.contentRatings, filters.excludeContentRatings);
    this.licensedOnly = filters.licensedOnly ?? false;
  }

  override getSections() {
    return [
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
