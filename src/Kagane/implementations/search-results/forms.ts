/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  TriStateSelectRow,
  closureSelector,
} from "@paperback/types";
import type { SearchFilter, SearchFilterValue } from "@paperback/types/lib/compat/0.8";

import type { KaganeSearchMetadata } from "../shared/models";
import { normalizeMetadata, parseRange } from "./parsers";

const FILTER_KEYS: Record<string, keyof KaganeSearchMetadata> = {
  formats: "formats",
  statuses: "statuses",
  publication_statuses: "publicationStatuses",
  languages: "languages",
  source_types: "sourceTypes",
  sources: "sources",
  year_from: "yearFrom",
  year_to: "yearTo",
  chapters_from: "chaptersFrom",
  chapters_to: "chaptersTo",
  creator: "creator",
  group: "group",
  ratings: "ratings",
  disturbing: "disturbing",
  genres: "genres",
  genres_match_all: "genresMatchAll",
  tags: "tags",
  tags_match_all: "tagsMatchAll",
  tags_text: "typedTags",
};

export class KaganeAdvancedSearchForm extends AdvancedSearchForm {
  private values: SearchFilterValue[];

  constructor(
    private metadata: KaganeSearchMetadata,
    private filters: SearchFilter[],
  ) {
    super();
    this.values = filters.map((filter) => {
      const stored = metadata[FILTER_KEYS[filter.id]];
      const value =
        stored === undefined
          ? filter.value
          : Array.isArray(stored)
            ? Object.fromEntries(stored.map((id) => [id, "included"]))
            : typeof stored === "boolean"
              ? String(stored)
              : stored;
      return { id: filter.id, value } as SearchFilterValue;
    });
  }

  override getSections() {
    return [
      Section(
        {
          id: "search",
          footer:
            "Empty ratings use your saved setting. Creator and group searches accept a full name or UUID.",
        },
        this.filters.map((filter) => {
          const selected = this.values.find((entry) => entry.id === filter.id)!;
          const onValueChange = closureSelector(
            this,
            filter.id,
            async (value: SearchFilterValue["value"]) => {
              selected.value = value;
            },
          );
          if (filter.type === "input")
            return InputRow(filter.id, {
              title: filter.title,
              value: typeof selected.value === "string" ? selected.value : "",
              onValueChange,
            });
          const items = filter.options.map((option) => ({ id: option.id, title: option.value }));
          if (filter.type === "dropdown")
            return SelectRow(filter.id, {
              title: filter.title,
              layout: "list",
              items,
              value: [typeof selected.value === "string" ? selected.value : ""],
              minItemCount: 1,
              maxItemCount: 1,
              onValueChange: closureSelector(this, filter.id, async (value: string[]) => {
                selected.value = value[0] ?? filter.value;
              }),
            });
          return TriStateSelectRow(filter.id, {
            title: filter.title,
            layout: "flow",
            items,
            value: selected.value as Record<string, "included" | "excluded">,
            allowExclusion: filter.allowExclusion,
            allowEmptySelection: true,
            onValueChange,
          });
        }),
      ),
    ];
  }

  override async formDidSubmit(): Promise<void> {
    const meta = this.getSearchQueryMetadata();
    parseRange(meta.yearFrom, meta.yearTo, "Release year");
    parseRange(meta.chaptersFrom, meta.chaptersTo, "Chapter count");
    await super.formDidSubmit();
  }

  override getSearchQueryMetadata(): KaganeSearchMetadata {
    const normalized = normalizeMetadata(this.values);
    return Object.fromEntries(
      Object.entries({ ...normalized, range: this.metadata.range }).filter(([, value]) => {
        if (value === undefined || value === "" || value === "default") return false;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === "object") return Object.keys(value).length > 0;
        return value !== true;
      }),
    ) as KaganeSearchMetadata;
  }
}
