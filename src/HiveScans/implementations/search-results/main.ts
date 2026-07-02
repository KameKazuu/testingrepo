/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type {
  PagedResults,
  Request,
  SearchQuery,
  SearchResultItem,
  SortingOption,
} from "@paperback/types";
import { URL } from "@paperback/types";
import {
  SearchFilterForm,
  type SearchFilter,
  type SearchFilterValue,
} from "@paperback/types/lib/compat/0.8";

import { fetchJSON } from "../../services/network";
import { DOMAIN_API, PAGE_SIZE } from "../shared/models";
import type { Metadata, HiveScansSearchResponse } from "../shared/models";
import { normalizeSearchTerm } from "../shared/utils";
import {
  buildSearchFilters,
  parseSearchResults,
  readDropdownFilter,
  SORT_OPTIONS,
} from "./parsers";

export class SearchProvider {
  async getSearchResults(
    query: SearchQuery<SearchFilterValue[]>,
    metadata?: Metadata,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const searchTerm = normalizeSearchTerm(query.title ?? "");

    const urlBuilder = new URL(DOMAIN_API)
      .addPathComponent("query")
      .setQueryItem("page", page.toString())
      .setQueryItem("perPage", PAGE_SIZE.toString())
      .setQueryItem("searchTerm", searchTerm);

    if (sortingOption?.id) {
      urlBuilder.setQueryItem("orderBy", sortingOption.id);
    }

    const filters = query.metadata ?? [];
    const status = readDropdownFilter(filters, "status", "");
    const type = readDropdownFilter(filters, "type", "");
    const genre = readDropdownFilter(filters, "genre", "");
    const direction = readDropdownFilter(filters, "direction", "");

    if (status) urlBuilder.setQueryItem("seriesStatus", status);
    if (type) urlBuilder.setQueryItem("seriesType", type);
    if (genre) urlBuilder.setQueryItem("genreIds", genre);
    if (direction) urlBuilder.setQueryItem("orderDirection", direction);

    const url = urlBuilder.toString();
    const request: Request = { url, method: "GET" };
    const data = await fetchJSON<HiveScansSearchResponse>(request);

    const results = parseSearchResults(data);
    const hasNextPage = data.totalCount > page * PAGE_SIZE;

    return {
      items: results,
      metadata: hasNextPage ? { page: page + 1 } : undefined,
    };
  }

  async getSearchFilters(): Promise<SearchFilter[]> {
    return buildSearchFilters();
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<SearchFilterValue[]>) {
    // TODO: Replace compat wrapper with proper search form implementation
    return new SearchFilterForm(query.metadata, this.getSearchFilters());
  }
}
