/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { DiscoverSection, DiscoverSectionItem, PagedResults, Request } from "@paperback/types";
import { CloudflareError, DiscoverSectionType, URL } from "@paperback/types";

import { apiHeaders, fetchJSON, getKaganeMetadata, warmTagTaxonomy } from "../../services/network";
import { buildSearchBody } from "../search-results/main";
import { getPopularTimeSpan } from "../settings-form/main";
import {
  API_URL,
  PAGE_SIZE,
  POPULAR_TIME_SPAN_OPTIONS,
  RANGE_OPTIONS,
  type KaganeSeriesDetailsResponse,
  type KaganeMetadata,
  type KaganeSearchSeries,
  type KaganeSearchResponse,
} from "../shared/models";
import { mapFeaturedItem, mapLatestItem, mapSimpleItem } from "./parsers";

// The Popular hero is the only section enriched with detail fetches (author /
// rating / views / description); the listing carries none of those. Kept to a
// handful of visible cards so discover stays light and doesn't multiply
// Cloudflare challenges. Latest and Recently Added render from listing data
// alone — no per-card detail requests.
const FEATURED_LIMIT = 10;

const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
  { id: "trending", title: "Trending", type: DiscoverSectionType.genres },
  { id: "latest", title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
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
    // Trending is a static set of range chips — resolve it before touching the
    // network so opening it costs no request.
    if (section.id === "trending") {
      return buildTrendingRangeItems();
    }

    const kaganeMetadata = await getKaganeMetadata();

    if (section.id === "genres") {
      return genreChips(kaganeMetadata);
    }

    const page = metadata?.page ?? 1;

    if (section.id === "popular") {
      const timeSpan = getPopularTimeSpan();
      const popularSort =
        POPULAR_TIME_SPAN_OPTIONS.find((option) => option.id === timeSpan)?.sort ??
        "total_views,desc";
      const data = await fetchDiscoverSearchPage(popularSort, page);
      const books = (data.content ?? []).slice(0, FEATURED_LIMIT);
      const details = await enrichDetails(books, FEATURED_LIMIT);
      const items = books.map((book) =>
        mapFeaturedItem(book, details.get(book.series_id), kaganeMetadata),
      );
      // Home has loaded and Cloudflare is cleared — warm the tag taxonomy in
      // the background so Advanced Search opens with tags already available.
      warmTagTaxonomy();
      return { items, metadata: undefined };
    }

    if (section.id === "latest") {
      const data = await fetchDiscoverSearchPage("updated_at,desc", page);
      const items = (data.content ?? []).map((book) => mapLatestItem(book, kaganeMetadata));
      return {
        items,
        metadata: data.last === false && items.length > 0 ? { page: page + 1 } : undefined,
      };
    }

    if (section.id === "recently_added") {
      const data = await fetchDiscoverSearchPage("created_at,desc", page);
      const items = (data.content ?? []).map((book) => mapSimpleItem(book, kaganeMetadata));
      return {
        items,
        metadata: data.last === false && items.length > 0 ? { page: page + 1 } : undefined,
      };
    }

    throw new Error(`Unknown discover section: ${section.id}`);
  }
}

// Fetch details for the first `limit` books (in parallel, after the section's
// own request has cleared Cloudflare) and key them by series id. Only the
// Popular hero uses this.
async function enrichDetails(
  books: KaganeSearchSeries[],
  limit: number,
): Promise<Map<string, KaganeSeriesDetailsResponse>> {
  const targets = books.slice(0, limit);
  const details = await Promise.all(targets.map((book) => fetchOptionalDetails(book.series_id)));
  const map = new Map<string, KaganeSeriesDetailsResponse>();
  targets.forEach((book, index) => {
    const detail = details[index];
    if (detail) map.set(book.series_id, detail);
  });
  return map;
}

// The browse feed is the search endpoint with the reader's own filter body and
// a sort (newest-first, most-viewed, …).
async function fetchDiscoverSearchPage(sort: string, page: number): Promise<KaganeSearchResponse> {
  const body = await buildSearchBody("", {});
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
  return fetchJSON<KaganeSearchResponse>(request);
}

async function fetchOptionalDetails(
  seriesId: string,
): Promise<KaganeSeriesDetailsResponse | undefined> {
  try {
    return await fetchJSON<KaganeSeriesDetailsResponse>({
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
        searchQuery: { title: "", metadata: { genres: { [id]: "included" } } },
      }),
    );
  return { items };
}

// Trending chips (Today / This Week / This Month) → a sorted search.
function buildTrendingRangeItems(): PagedResults<DiscoverSectionItem> {
  const items = RANGE_OPTIONS.map(
    (range): DiscoverSectionItem => ({
      type: "genresCarouselItem",
      name: range.title,
      searchQuery: { title: "", metadata: { range: range.id } },
    }),
  );
  return { items };
}
