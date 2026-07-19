/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import { type OptionItem, type SearchMetadata } from "../models";

// Genre options are fetched from the API and injected by the extension, so the
// filter list always matches the live taxonomy.
export class KaganeAdvancedSearchForm extends AdvancedSearchForm {
  private genres: string[];
  private genreTags: Tag[];

  constructor(searchQuery: SearchQuery<SearchMetadata>, genreOptions: OptionItem[]) {
    super();
    this.genres = searchQuery.metadata?.genres ?? [];
    this.genreTags = genreOptions.map((option) => ({ id: option.id, title: option.value }));
  }

  override getSections() {
    if (this.genreTags.length === 0) return [];
    return [
      Section("genres", [
        SelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          options: this.genreTags,
          minItemCount: 0,
          maxItemCount: this.genreTags.length,
          onValueChange: Application.Selector(
            this as KaganeAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: string[]): Promise<void> {
    this.genres = value;
  }

  override getSearchQueryMetadata(): SearchMetadata {
    const result: SearchMetadata = {};
    if (this.genres.length > 0) result.genres = this.genres;
    return result;
  }
}
