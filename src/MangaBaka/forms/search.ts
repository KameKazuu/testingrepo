/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { AdvancedSearchForm, type Metadata, Section, SelectRow, ToggleRow } from "@paperback/types";

import { CONTENT_RATINGS, type SearchFilters, SERIES_STATUSES, SERIES_TYPES } from "../models";

export class SearchFiltersForm extends AdvancedSearchForm {
  private types: string[];
  private statuses: string[];
  private contentRatings: string[];
  private licensedOnly: boolean;

  constructor(filters: SearchFilters) {
    super();
    this.types = filters.types ?? [];
    this.statuses = filters.statuses ?? [];
    this.contentRatings = filters.contentRatings ?? [];
    this.licensedOnly = filters.licensedOnly ?? false;
  }

  override getSections() {
    return [
      Section({ id: "type", footer: "Leave a filter empty to include everything" }, [
        SelectRow("types", {
          title: "Type",
          value: this.types,
          layout: "flow",
          items: SERIES_TYPES,
          minItemCount: 0,
          maxItemCount: SERIES_TYPES.length,
          onValueChange: Application.Selector(this as SearchFiltersForm, "handleTypesChange"),
        }),
        SelectRow("statuses", {
          title: "Status",
          value: this.statuses,
          layout: "flow",
          items: SERIES_STATUSES,
          minItemCount: 0,
          maxItemCount: SERIES_STATUSES.length,
          onValueChange: Application.Selector(this as SearchFiltersForm, "handleStatusesChange"),
        }),
        SelectRow("contentRatings", {
          title: "Content Rating",
          value: this.contentRatings,
          layout: "flow",
          items: CONTENT_RATINGS,
          minItemCount: 0,
          maxItemCount: CONTENT_RATINGS.length,
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

  // A select row renders its parent-side summary once, when the section is
  // built, so the form has to be rebuilt for the new selection to show.
  async handleTypesChange(value: string[]): Promise<void> {
    this.types = value;
    this.reloadForm();
  }

  async handleStatusesChange(value: string[]): Promise<void> {
    this.statuses = value;
    this.reloadForm();
  }

  async handleContentRatingsChange(value: string[]): Promise<void> {
    this.contentRatings = value;
    this.reloadForm();
  }

  async handleLicensedOnlyChange(value: boolean): Promise<void> {
    this.licensedOnly = value;
  }

  override getSearchQueryMetadata(): Metadata {
    const filters: SearchFilters = {};
    if (this.types.length > 0) filters.types = this.types;
    if (this.statuses.length > 0) filters.statuses = this.statuses;
    if (this.contentRatings.length > 0) filters.contentRatings = this.contentRatings;
    if (this.licensedOnly) filters.licensedOnly = true;

    return filters;
  }
}
