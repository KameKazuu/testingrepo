/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { DiscoverSection, DiscoverSectionItem, PagedResults, Request } from "@paperback/types";
import { DiscoverSectionType, URL } from "@paperback/types";

import { apiHeaders, fetchJSON, getKaganeMetadata } from "../../services/network";
import { buildSearchBody } from "../search-results/main";
import {
  API_URL,
  PAGE_SIZE,
  RANGE_OPTIONS,
  type KaganeMetadata,
  type KaganeSearchResponse,
} from "../shared/models";
import { mapFeaturedItem, mapLatestItem, mapSimpleItem } from "./parsers";

const FEATURED_LIMIT = 10;

const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
  { id: "trending", title: "Trending", type: DiscoverSectionType.genres },
  { id: "latest", title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
  { id: "recently_added", title: "Recently Added", type: DiscoverSectionType.simpleCarousel },
  { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
];

// Paperback asks for discover sections independently. Share the taxonomy load
// so a cold refresh cannot start duplicate genre/source request pairs.
let discoverMetadataPromise: Promise<KaganeMetadata> | undefined;
const discoverPagePromises = new Map<string, Promise<KaganeSearchResponse>>();

function getDiscoverMetadata(): Promise<KaganeMetadata> {
  const request = (discoverMetadataPromise ??= getKaganeMetadata().catch((error: unknown) => {
    if (discoverMetadataPromise === request) discoverMetadataPromise = undefined;
    throw error;
  }));
  return request;
}

export class DiscoverProvider {
  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS;
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: { page?: number },
  ): Promise<PagedResults<DiscoverSectionItem>> {
    // Trending is a static set of range chips and should never touch the network.
    if (section.id === "trending") {
      return buildTrendingRangeItems();
    }

    const kaganeMetadata = await getDiscoverMetadata();

    if (section.id === "genres") {
      return genreChips(kaganeMetadata);
    }

    const page = metadata?.page ?? 1;

    if (section.id === "popular") {
      // The listing already carries the cover, title, format, genres, status,
      // source id, and content rating needed for a useful hero card. Avoid one
      // detail request per card and ask the API only for the ten cards displayed.
      const data = await fetchDiscoverSearchPage("total_views,desc", page, FEATURED_LIMIT);
      const items = (data.content ?? []).map((book) =>
        mapFeaturedItem(book, undefined, kaganeMetadata),
      );
      return { items, metadata: undefined };
    }

    if (section.id === "latest") {
      const data = await fetchDiscoverSearchPage("updated_at,desc", page, PAGE_SIZE);
      const items = (data.content ?? []).map((book) => mapLatestItem(book, kaganeMetadata));
      return {
        items,
        metadata: data.last === false && items.length > 0 ? { page: page + 1 } : undefined,
      };
    }

    if (section.id === "recently_added") {
      const data = await fetchDiscoverSearchPage("created_at,desc", page, PAGE_SIZE);
      const items = (data.content ?? []).map((book) => mapSimpleItem(book, kaganeMetadata));
      return {
        items,
        metadata: data.last === false && items.length > 0 ? { page: page + 1 } : undefined,
      };
    }

    throw new Error(`Unknown discover section: ${section.id}`);
  }
}

// The browse feed is the search endpoint with the reader's filter body and a
// sort. Duplicate in-flight calls share one response instead of poking
// Cloudflare twice during refresh/retry bursts.
async function fetchDiscoverSearchPage(
  sort: string,
  page: number,
  size: number,
): Promise<KaganeSearchResponse> {
  const body = await buildSearchBody("", {});
  const serializedBody = JSON.stringify(body);
  const key = `${sort}:${page}:${size}:${serializedBody}`;
  const cached = discoverPagePromises.get(key);
  if (cached) return cached;

  const url = new URL(API_URL)
    .addPathComponent("api")
    .addPathComponent("v2")
    .addPathComponent("search")
    .addPathComponent("series")
    .setQueryItem("page", String(page - 1))
    .setQueryItem("size", String(size))
    .setQueryItem("sort", sort)
    .toString();

  const request: Request = {
    url,
    method: "POST",
    headers: apiHeaders(),
    body: serializedBody,
  };
  const promise = fetchJSON<KaganeSearchResponse>(request).finally(() => {
    if (discoverPagePromises.get(key) === promise) discoverPagePromises.delete(key);
  });
  discoverPagePromises.set(key, promise);
  return promise;
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
