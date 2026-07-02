/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Request, SearchResultItem, SortingOption } from "@paperback/types";
import { ContentRating, URL } from "@paperback/types";
import type { SearchFilter, SearchFilterValue } from "@paperback/types/lib/compat/0.8";

import { fetchJSON } from "../../services/network";
import { DOMAIN_API } from "../shared/models";
import type { HiveScansGenre, HiveScansSearchResponse } from "../shared/models";
import { encodeMangaId, formatSeriesSubtitle, isNovel } from "../shared/utils";

// Mirrors the Iken platform's `sortOptions` (see keiyoushi's `lib-multisrc/iken`).
export const SORT_OPTIONS: SortingOption[] = [
  { id: "lastChapterAddedAt", label: "Last Chapter" },
  { id: "totalViews", label: "Views" },
  { id: "createdAt", label: "Added Date" },
  { id: "chaptersCount", label: "Chapters Count" },
  { id: "postTitle", label: "Alphabetical" },
];

async function fetchGenres(): Promise<HiveScansGenre[]> {
  const url = new URL(DOMAIN_API).addPathComponent("genres").toString();
  const request: Request = { url, method: "GET" };
  return await fetchJSON<HiveScansGenre[]>(request);
}

export async function buildSearchFilters(): Promise<SearchFilter[]> {
  const genres = await fetchGenres();

  return [
    {
      type: "dropdown",
      id: "status",
      title: "Status",
      options: [
        { id: "", value: "All" },
        { id: "ONGOING", value: "Ongoing" },
        { id: "COMPLETED", value: "Completed" },
        { id: "CANCELLED", value: "Cancelled" },
        { id: "DROPPED", value: "Dropped" },
        { id: "COMING_SOON", value: "Coming Soon" },
        { id: "MASS_RELEASED", value: "Mass Released" },
      ],
      value: "",
    },
    {
      type: "dropdown",
      id: "type",
      title: "Type",
      options: [
        { id: "", value: "All Types" },
        { id: "MANGA", value: "Manga" },
        { id: "MANHUA", value: "Manhua" },
        { id: "MANHWA", value: "Manhwa" },
      ],
      value: "",
    },
    {
      type: "dropdown",
      id: "genre",
      title: "Genre",
      options: [
        { id: "", value: "All Genres" },
        ...genres.map((genre) => ({ id: genre.id.toString(), value: genre.name.trim() })),
      ],
      value: "",
    },
    {
      type: "dropdown",
      id: "direction",
      title: "Sort Direction",
      options: [
        { id: "", value: "Default" },
        { id: "desc", value: "Descending" },
        { id: "asc", value: "Ascending" },
      ],
      value: "",
    },
  ];
}

export function readDropdownFilter(
  filters: SearchFilterValue[],
  filterId: string,
  fallback: string,
): string {
  const entry = filters.find((filter) => filter.id === filterId);
  if (!entry) return fallback;
  return typeof entry.value === "string" && entry.value.trim() ? entry.value.trim() : fallback;
}

export function parseSearchResults(data: HiveScansSearchResponse): SearchResultItem[] {
  return (data.posts ?? [])
    .filter((post) => !isNovel(post))
    .map((post) => ({
      mangaId: encodeMangaId(post.slug),
      title: Application.decodeHTMLEntities(post.postTitle),
      imageUrl: post.featuredImage ?? "",
      subtitle: formatSeriesSubtitle(post.seriesType, post.seriesStatus),
      contentRating: ContentRating.EVERYONE,
    }));
}
