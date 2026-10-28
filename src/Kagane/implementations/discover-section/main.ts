/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { DiscoverSection, DiscoverSectionItem, PagedResults, Request } from "@paperback/types";
import { ContentRating, DiscoverSectionType, URL } from "@paperback/types";

import {
  apiHeaders,
  fetchJSON,
  fetchTrendingChart,
  getKaganeMetadata,
} from "../../services/network";
import { buildSearchBody } from "../search-results/main";
import {
  getContentRatingSelections,
  getHiddenFormats,
  getExcludedGenres,
  getContentLanguages,
} from "../settings-form/main";
import {
  PAGE_SIZE,
  RANGE_OPTIONS,
  type KaganeMetadata,
  type KaganeSearchResponse,
} from "../shared/models";
import { getBaseUrl } from "../shared/parsers";
import { isKaganeRatingAllowed } from "../shared/utils";
import { mapFeaturedItem, mapLatestItem, mapSimpleItem } from "./parsers";

const DISCOVER_SECTIONS: DiscoverSection[] = [
  { id: "popular", title: "Popular", type: DiscoverSectionType.featured },
  { id: "weekly_chart", title: "Trending This Week", type: DiscoverSectionType.simpleCarousel },
  { id: "trending", title: "Popularity by Period", type: DiscoverSectionType.genres },
  { id: "latest", title: "Latest Updates", type: DiscoverSectionType.chapterUpdates },
  { id: "recently_added", title: "Recently Added", type: DiscoverSectionType.simpleCarousel },
  { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
];

const discoverPagePromises = new Map<string, Promise<KaganeSearchResponse>>();

function isPresent<T>(value: T | undefined): value is T {
  return value != undefined;
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

    const kaganeMetadata = await getKaganeMetadata();

    if (section.id === "genres") {
      return genreChips(kaganeMetadata);
    }

    const page = metadata?.page ?? 1;

    if (section.id === "weekly_chart") {
      if (page > 1) return { items: [] };
      const data = await fetchTrendingChart(await buildSearchBody("", {}));
      return {
        items: data.items
          .filter((entry) => {
            const book = entry.series;
            const excluded = getExcludedGenres().map((id) =>
              kaganeMetadata.genres[id]?.toLowerCase(),
            );
            return (
              !entry.hidden_by_filter &&
              !getHiddenFormats().includes(book.format ?? "") &&
              !(book.genres ?? []).some((genre) => excluded.includes(genre.toLowerCase())) &&
              getContentLanguages().some(
                (language) => language.toLowerCase() === book.translated_language?.toLowerCase(),
              )
            );
          })
          .map((entry) => {
            const item = mapSimpleItem(entry.series, kaganeMetadata);
            if (!item || item.type !== "simpleCarouselItem") return undefined;
            const movement = entry.is_new
              ? "New"
              : entry.delta
                ? `${entry.delta > 0 ? "Up" : "Down"} ${Math.abs(entry.delta)}`
                : undefined;
            return {
              ...item,
              // The chart omits per-title ratings; use the strictest allowed rating.
              contentRating: getContentRatingSelections().some(
                (rating) => rating === "erotica" || rating === "pornographic",
              )
                ? ContentRating.ADULT
                : getContentRatingSelections().includes("suggestive")
                  ? ContentRating.MATURE
                  : ContentRating.EVERYONE,
              subtitle: [
                `Rank ${entry.position}`,
                movement,
                entry.series.current_books === undefined
                  ? undefined
                  : `${entry.series.current_books} Chapters`,
              ]
                .filter(Boolean)
                .join(" • "),
            };
          })
          .filter(isPresent),
      };
    }

    if (section.id === "popular") {
      // Map the listing directly; featured cards must not fan out into detail requests.
      const data = await fetchDiscoverSearchPage("total_views,desc", page, PAGE_SIZE);
      const items = (data.content ?? [])
        .filter((book) => isKaganeRatingAllowed(book, getContentRatingSelections()))
        .map((book) => mapFeaturedItem(book, kaganeMetadata))
        .filter(isPresent);
      return { items, metadata: data.last === false ? { page: page + 1 } : undefined };
    }

    if (section.id === "latest") {
      const data = await fetchDiscoverSearchPage("updated_at,desc", page, PAGE_SIZE);
      const items = (data.content ?? [])
        .filter((book) => isKaganeRatingAllowed(book, getContentRatingSelections()))
        .map((book) => mapLatestItem(book, kaganeMetadata))
        .filter(isPresent);
      return {
        items,
        metadata: data.last === false ? { page: page + 1 } : undefined,
      };
    }

    if (section.id === "recently_added") {
      const data = await fetchDiscoverSearchPage("created_at,desc", page, PAGE_SIZE);
      const items = (data.content ?? [])
        .filter((book) => isKaganeRatingAllowed(book, getContentRatingSelections()))
        .map((book) => mapSimpleItem(book, kaganeMetadata))
        .filter(isPresent);
      return {
        items,
        metadata: data.last === false ? { page: page + 1 } : undefined,
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

  const url = new URL(getBaseUrl())
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
    .map(([id, name]): DiscoverSectionItem => ({
      type: "genresCarouselItem",
      name,
      searchQuery: { title: "", metadata: { genres: { [id]: "included" } } },
    }));
  return { items };
}

// Trending chips (Today / This Week / This Month) → a sorted search.
function buildTrendingRangeItems(): PagedResults<DiscoverSectionItem> {
  const items = RANGE_OPTIONS.map((range): DiscoverSectionItem => ({
    type: "genresCarouselItem",
    name: range.title,
    searchQuery: { title: "", metadata: { range: range.id } },
  }));
  return { items };
}
