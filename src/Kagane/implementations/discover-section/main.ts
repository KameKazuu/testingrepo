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
  type KaganeSearchBook,
  type SearchDto,
} from "../shared/models";
import { mapFeaturedItem, mapLatestItem, mapSimpleItem } from "./parsers";

// How many cards to enrich with a detail fetch (author / rating / views). The
// listing API carries none of those, so this is the visible-card budget — kept
// small so discover stays light (and doesn't multiply Cloudflare challenges).
const FEATURED_LIMIT = 10;
const ENRICH_LIMIT = 15;

const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
  { id: "latest", title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
  { id: "trending", title: "Trending", type: DiscoverSectionType.genres },
  { id: "recently_added", title: "Recently Added", type: DiscoverSectionType.simpleCarousel },
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
      const details = await enrichDetails(books, FEATURED_LIMIT);
      const items = books.map((book) =>
        mapFeaturedItem(book, details.get(book.series_id), kaganeMetadata),
      );
      return { items, metadata: undefined };
    }

    if (section.id === "latest") {
      const data = await searchSection("updated_at,desc", page, kaganeMetadata);
      const books = data.content ?? [];
      const details = await enrichDetails(books, ENRICH_LIMIT);
      const items = books.map((book) =>
        mapLatestItem(book, details.get(book.series_id), kaganeMetadata),
      );
      return {
        items,
        metadata: data.last === false && items.length > 0 ? { page: page + 1 } : undefined,
      };
    }

    if (section.id === "recently_added") {
      const data = await searchSection("created_at,desc", page, kaganeMetadata);
      const books = data.content ?? [];
      const details = await enrichDetails(books, ENRICH_LIMIT);
      const items = books.map((book) =>
        mapSimpleItem(book, details.get(book.series_id), kaganeMetadata),
      );
      return {
        items,
        metadata: data.last === false && items.length > 0 ? { page: page + 1 } : undefined,
      };
    }

    throw new Error(`Unknown discover section: ${section.id}`);
  }
}

// Fetch details for the first `limit` books (in parallel, after the section's
// own request has cleared Cloudflare) and key them by series id.
async function enrichDetails(
  books: KaganeSearchBook[],
  limit: number,
): Promise<Map<string, DetailsDto>> {
  const targets = books.slice(0, limit);
  const details = await Promise.all(targets.map((book) => safeDetail(book.series_id)));
  const map = new Map<string, DetailsDto>();
  targets.forEach((book, index) => {
    const detail = details[index];
    if (detail) map.set(book.series_id, detail);
  });
  return map;
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

// Trending chips (Today / This Week / This Month) → a sorted search.
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
