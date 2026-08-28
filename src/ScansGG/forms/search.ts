/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  STATUS_OPTIONS,
  TAG_OPTIONS,
  TYPE_OPTIONS,
  type OptionItem,
  type SearchMetadata,
} from "../models";

const toTags = (options: OptionItem[]): Tag[] =>
  options.map((option) => ({ id: option.id, title: option.value }));

const TYPE_TAGS = toTags(TYPE_OPTIONS);
const STATUS_TAGS = toTags(STATUS_OPTIONS);
const TAG_TAGS = toTags(TAG_OPTIONS);

// The API filters are inclusive multi-select (q_type / q_status / q_tags), so
// every field is a plain multi-select of numeric ids.
export class ScansGGAdvancedSearchForm extends AdvancedSearchForm {
  private types: string[];
  private statuses: string[];
  private tags: string[];

  constructor(searchQuery: SearchQuery<SearchMetadata>) {
    super();
    const meta = searchQuery.metadata ?? {};
    this.types = meta.types ?? [];
    this.statuses = meta.statuses ?? [];
    this.tags = meta.tags ?? [];
  }

  override getSections() {
    return [
      Section("type", [
        SelectRow("types", {
          title: "Type",
          layout: "flow",
          value: this.types,
          options: TYPE_TAGS,
          minItemCount: 0,
          maxItemCount: TYPE_TAGS.length,
          onValueChange: Application.Selector(
            this as ScansGGAdvancedSearchForm,
            "handleTypesChange",
          ),
        }),
      ]),
      Section("status", [
        SelectRow("statuses", {
          title: "Status",
          layout: "flow",
          value: this.statuses,
          options: STATUS_TAGS,
          minItemCount: 0,
          maxItemCount: STATUS_TAGS.length,
          onValueChange: Application.Selector(
            this as ScansGGAdvancedSearchForm,
            "handleStatusesChange",
          ),
        }),
      ]),
      Section("tags", [
        SelectRow("tags", {
          title: "Tags",
          layout: "flow",
          value: this.tags,
          options: TAG_TAGS,
          minItemCount: 0,
          maxItemCount: TAG_TAGS.length,
          onValueChange: Application.Selector(
            this as ScansGGAdvancedSearchForm,
            "handleTagsChange",
          ),
        }),
      ]),
    ];
  }

  async handleTypesChange(value: string[]): Promise<void> {
    this.types = value;
  }

  async handleStatusesChange(value: string[]): Promise<void> {
    this.statuses = value;
  }

  async handleTagsChange(value: string[]): Promise<void> {
    this.tags = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.types.length > 0) result.types = this.types;
    if (this.statuses.length > 0) result.statuses = this.statuses;
    if (this.tags.length > 0) result.tags = this.tags;
    return result;
  }
}
