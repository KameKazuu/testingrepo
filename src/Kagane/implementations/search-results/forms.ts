/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  closureSelector,
  InputRow,
  Section,
  SelectSection,
  TriStateSelectRow,
  type FormSectionElement,
  type JSONObject,
  type SearchQuery,
} from "@paperback/types";

import {
  FORMAT_OPTIONS,
  LANGUAGE_OPTIONS,
  PUBLICATION_STATUS_OPTIONS,
  SOURCE_TYPE_OPTIONS,
} from "../shared/models";

export interface KaganeSearchMetadata extends JSONObject {
  /** Trending window id from the discover chips (today / week / month). */
  range?: string;
  formats?: string[];
  statuses?: string[];
  languages?: string[];
  sourceTypes?: string[];
  sources?: string[];
  yearFrom?: string;
  yearTo?: string;
  genres?: Record<string, "included" | "excluded">;
  /** Single-element ["AND"] / ["OR"] to match SelectSection's binding. */
  genresMatchAll?: string[];
  tags?: Record<string, "included" | "excluded">;
  tagsMatchAll?: string[];
  /** Comma-separated tag names; "-name" excludes ("romance, -gore"). */
  typedTags?: string;
}

export interface FilterItem {
  id: string;
  title: string;
}

const OPERATOR_ITEMS = [
  { id: "AND", title: "All (AND)" },
  { id: "OR", title: "Any (OR)" },
];

const FORMAT_ITEMS = FORMAT_OPTIONS.map((format) => ({ id: format, title: format }));
const STATUS_ITEMS = PUBLICATION_STATUS_OPTIONS.map((status) => ({
  id: status.id,
  title: status.value,
}));
const LANGUAGE_ITEMS = LANGUAGE_OPTIONS.map((language) => ({
  id: language.id,
  title: language.title,
}));
const SOURCE_TYPE_ITEMS = SOURCE_TYPE_OPTIONS.map((type) => ({ id: type, title: type }));

export class KaganeAdvancedSearchForm extends AdvancedSearchForm {
  private metadata: KaganeSearchMetadata;
  private genreItems: FilterItem[];
  private tagItems: FilterItem[];
  private sourceItems: FilterItem[];

  constructor(
    searchQuery: SearchQuery<KaganeSearchMetadata>,
    genreItems: FilterItem[],
    tagItems: FilterItem[],
    sourceItems: FilterItem[],
  ) {
    super();
    const raw = searchQuery.metadata;
    const meta: KaganeSearchMetadata = raw && !Array.isArray(raw) ? raw : {};
    meta.formats ??= [];
    meta.statuses ??= [];
    meta.languages ??= [];
    meta.sourceTypes ??= [];
    meta.sources ??= [];
    meta.yearFrom ??= "";
    meta.yearTo ??= "";
    meta.genres ??= {};
    meta.genresMatchAll ??= ["AND"];
    meta.tags ??= {};
    meta.tagsMatchAll ??= ["AND"];
    meta.typedTags ??= "";
    this.metadata = meta;
    this.genreItems = genreItems;
    this.tagItems = tagItems;
    this.sourceItems = sourceItems;
  }

  override getSearchQueryMetadata(): KaganeSearchMetadata {
    return this.metadata;
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      this.multiSelectSection("formats", "Format", this.metadata.formats!, FORMAT_ITEMS),
      this.multiSelectSection("statuses", "Status", this.metadata.statuses!, STATUS_ITEMS),
      this.multiSelectSection("languages", "Language", this.metadata.languages!, LANGUAGE_ITEMS),
      this.multiSelectSection(
        "sourceTypes",
        "Source Type",
        this.metadata.sourceTypes!,
        SOURCE_TYPE_ITEMS,
      ),
      this.triStateSection("genres", "Genres", this.metadata.genres!, this.genreItems, (value) => {
        this.metadata.genres = value;
      }),
      this.operatorSection("genresMatchAll", "Match Genres", this.metadata.genresMatchAll!),
      ...(this.tagItems.length > 0
        ? [
            this.triStateSection("tags", "Tags", this.metadata.tags!, this.tagItems, (value) => {
              this.metadata.tags = value;
            }),
          ]
        : []),
      this.inputSection({
        sectionId: "typed_tags_section",
        header: "Tags (typed)",
        rowId: "typedTags",
        title: "romance, -gore",
        value: this.metadata.typedTags!,
        apply: (value) => {
          this.metadata.typedTags = value;
        },
      }),
      this.operatorSection("tagsMatchAll", "Match Tags", this.metadata.tagsMatchAll!),
      ...(this.sourceItems.length > 0
        ? [
            this.multiSelectSection(
              "sources",
              "Sources",
              this.metadata.sources!,
              this.sourceItems,
              "list",
            ),
          ]
        : []),
      this.inputSection({
        sectionId: "year_from_section",
        header: "Release Year From",
        rowId: "yearFrom",
        title: "e.g. 2018",
        value: this.metadata.yearFrom!,
        apply: (value) => {
          this.metadata.yearFrom = value;
        },
      }),
      this.inputSection({
        sectionId: "year_to_section",
        header: "Release Year To",
        rowId: "yearTo",
        title: "e.g. 2024",
        value: this.metadata.yearTo!,
        apply: (value) => {
          this.metadata.yearTo = value;
        },
      }),
    ];
  }

  private multiSelectSection(
    id: string,
    header: string,
    value: string[],
    items: FilterItem[],
    layout: "flow" | "list" = "flow",
  ): FormSectionElement<unknown> {
    // SelectSection mutates `value` in place, so no onValueChange is needed.
    return SelectSection(this, {
      id,
      header,
      layout,
      value,
      items,
      minItemCount: 0,
      maxItemCount: items.length,
    });
  }

  private operatorSection(
    id: string,
    header: string,
    value: string[],
  ): FormSectionElement<unknown> {
    return SelectSection(this, {
      id,
      header,
      layout: "flow",
      value,
      items: OPERATOR_ITEMS,
      minItemCount: 1,
      maxItemCount: 1,
    });
  }

  private triStateSection(
    id: string,
    header: string,
    value: Record<string, "included" | "excluded">,
    items: FilterItem[],
    apply: (value: Record<string, "included" | "excluded">) => void,
  ): FormSectionElement<unknown> {
    return Section({ id: `${id}_section`, header }, [
      TriStateSelectRow(id, {
        title: header,
        layout: "list",
        value,
        items,
        allowExclusion: true,
        allowEmptySelection: true,
        onValueChange: closureSelector(
          this,
          id,
          async (newValue: Record<string, "included" | "excluded">) => {
            apply(newValue);
          },
        ),
      }),
    ]);
  }

  private inputSection(opts: {
    sectionId: string;
    header: string;
    rowId: string;
    title: string;
    value: string;
    apply: (value: string) => void;
  }): FormSectionElement<unknown> {
    return Section({ id: opts.sectionId, header: opts.header }, [
      InputRow(opts.rowId, {
        title: opts.title,
        value: opts.value,
        onValueChange: closureSelector(this, opts.rowId, async (value: string) => {
          opts.apply(value);
        }),
      }),
    ]);
  }
}
