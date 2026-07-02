/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { DiscoverSection, DiscoverSectionItem, PagedResults, Request } from "@paperback/types";
import { DiscoverSectionType, URL } from "@paperback/types";

import { fetchJSON } from "../../services/network";
import { DOMAIN_API, PAGE_SIZE } from "../shared/models";
import type { HiveScansSearchResponse } from "../shared/models";
import { parseDiscoverItems } from "./parsers";

const SECTIONS: DiscoverSection[] = [
  { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
  { id: "latest", title: "Latest Updates", type: DiscoverSectionType.simpleCarousel },
];

const ORDER_BY: Record<string, string> = {
  popular: "totalViews",
  latest: "lastChapterAddedAt",
};

export class DiscoverProvider {
  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    _metadata?: { page?: number },
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const orderBy = ORDER_BY[section.id];
    if (!orderBy) {
      return { items: [] };
    }

    const url = new URL(DOMAIN_API)
      .addPathComponent("query")
      .setQueryItem("page", "1")
      .setQueryItem("perPage", PAGE_SIZE.toString())
      .setQueryItem("searchTerm", "")
      .setQueryItem("orderBy", orderBy)
      .toString();

    const request: Request = { url, method: "GET" };
    const data = await fetchJSON<HiveScansSearchResponse>(request);
    const items = parseDiscoverItems(data, section.id);

    return { items, metadata: undefined };
  }
}
