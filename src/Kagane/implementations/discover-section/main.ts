/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { DiscoverSection, DiscoverSectionItem, PagedResults, Request } from "@paperback/types";
import { CloudflareError, DiscoverSectionType, URL } from "@paperback/types";

import { apiHeaders, fetchJSON, getKaganeMetadata } from "../../services/network";
import { buildSearchBody } from "../search-results/main";
import {
  API_URL,
  PAGE_SIZE,
  RANGE_OPTIONS,
  type DetailsDto,
  type KaganeMetadata,
  type SearchDto,
} from "../shared/models";
import { mapFeaturedItem, mapLatestItem } from "./parsers";

// How many Popular cards to enrich with a detail fetch (description / author /
// rating / views). The hero carousel shows a handful, so this stays small.
const FEATURED_LIMIT = 10;

const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
  { id: "latest", title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
  { id: "trending", title: "Trending", type: DiscoverSectionType.genres },
  { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
];

export class DiscoverProvider {
  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: { page?: number },
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const kaganeMetadata = await getKaganeMetadata();

    if (section.id === "genres") {
      return genreChips(kaganeMetadata);
    }
    if (section.id === "trending") {
      return rangeChips();
    }

    const page = metadata?.page ?? 1;

    if (section.id === "popular") {
      const data = await searchSection("total_views,desc", page, kaganeMetadata);
      const books = (data.content ?? []).slice(0, FEATURED_LIMIT);
      const details = await Promise.all(books.map((book) => safeDetail(book.series_id)));
      const items = books.map((book, index) =>
        mapFeaturedItem(book, details[index], kaganeMetadata),
      );
      return { items, metadata: undefined };
    }

    if (section.id === "latest") {
      const data = await searchSection("updated_at,desc", page, kaganeMetadata);
      const items = (data.content ?? []).map((book) => mapLatestItem(book, kaganeMetadata));
      return {
        items,
        metadata: data.last === false && items.length > 0 ? { page: page + 1 } : undefined,
      };
    }

    throw new Error(`Unknown discover section: ${section.id}`);
  }
}

// The browse feed is the search endpoint with the reader's own filter body and
// a sort (newest-first, most-viewed, …).
async function searchSection(
  sort: string,
  page: number,
  metadata: KaganeMetadata,
): Promise<SearchDto> {
  const body = buildSearchBody({ title: "", metadata: [] }, metadata);
  const url = new URL(API_URL)
    .addPathComponent("api")
    .addPathComponent("v2")
    .addPathComponent("search")
    .addPathComponent("series")
    .setQueryItem("page", String(page - 1))
    .setQueryItem("size", String(PAGE_SIZE))
    .setQueryItem("sort", sort)
    .toString();

  const request: Request = {
    url,
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(body),
  };
  return fetchJSON<SearchDto>(request);
}

async function safeDetail(seriesId: string): Promise<DetailsDto | undefined> {
  try {
    return await fetchJSON<DetailsDto>({
      url: new URL(API_URL)
        .addPathComponent("api")
        .addPathComponent("v2")
        .addPathComponent("series")
        .addPathComponent(seriesId)
        .toString(),
      method: "GET",
      headers: apiHeaders(),
    });
  } catch (error) {
    if (error instanceof CloudflareError) throw error;
    return undefined;
  }
}

// Genre chips → a filtered search on that genre.
function genreChips(metadata: KaganeMetadata): PagedResults<DiscoverSectionItem> {
  const items = Object.entries(metadata.genres)
    .sort(([, left], [, right]) => left.localeCompare(right))
    .map(
      ([id, name]): DiscoverSectionItem => ({
        type: "genresCarouselItem",
        name,
        searchQuery: { title: "", metadata: [{ id: "genres", value: { [id]: "included" } }] },
      }),
    );
  return { items };
}

// Trending chips (Today / This Week / This Month / All Time) → a sorted search.
function rangeChips(): PagedResults<DiscoverSectionItem> {
  const items = RANGE_OPTIONS.map(
    (range): DiscoverSectionItem => ({
      type: "genresCarouselItem",
      name: range.title,
      searchQuery: { title: "", metadata: [{ id: "range", value: range.id }] },
    }),
  );
  return { items };
}
