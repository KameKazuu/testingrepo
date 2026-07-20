/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { JSONObject } from "@paperback/types";

/** Main website — HTML pages carry the data payloads and serve as Referer. */
export const DOMAIN = "https://omanga.to";

/** Number of items a catalog page returns when full. */
export const CATALOG_PAGE_SIZE = 36;

/** Series card as embedded in catalog pages. */
export interface CatalogItem {
  id: number;
  title: string;
  slug: string;
  poster: string;
  type?: string; // "Manga", "Manhwa", "Manhua", …
  genres?: string[];
  rating?: number;
  views?: number;
  votes?: number;
  _count?: { chapters?: number };
}

/** One chapter row in the series payload's `chapters` array. */
export interface ChapterEntry {
  id: number;
  mangaId: number;
  number: number;
  volume?: number | null;
  title?: string | null;
  createdAt?: string | null; // "$D2026-07-14T02:23:00.772Z"
  translator?: string | null;
  isLocked?: boolean;
  team?: { id?: number; name?: string; slug?: string } | null;
}

/** Series payload embedded in `/manga/<slug>` pages. */
export interface SeriesProps {
  mangaId: number;
  slug: string;
  title: string;
  description?: string;
  genres?: string[];
  tags?: string[];
  publisher?: string;
  author?: string;
  artist?: string;
  translator?: string;
  status?: string; // "Ongoing", "Completed", "Hiatus", "Cancelled", "Announced"
  ageRating?: string; // "For all", "12+", "15+", "16+", "18+", "21+"
  altNames?: string[];
  chapters?: ChapterEntry[];
}

/** Chapter payload embedded in `/manga/<slug>/chapter/<number>` pages. */
export interface ReaderChapter {
  id: number;
  number: number;
  title?: string | null;
  volume?: number | null;
  pages?: string[];
  pagesAlt?: string[];
  translator?: string | null;
  team?: { name?: string; slug?: string } | null;
}

/** Pagination cursor for Paperback's PagedResults. */
export interface Metadata extends JSONObject {
  page: number;
  // First item id of the previous page — detects a server that ignored `page`
  // and echoed the same list, so pagination stops instead of looping.
  firstId?: number;
}

/** Advanced-search selections carried through SearchQuery.metadata. */
export type SearchMetadata = {
  genres?: string[];
  types?: string[];
  statuses?: string[];
  year?: string;
  tag?: string;
};

export type OptionItem = {
  id: string;
  value: string;
};

const toOptions = (values: string[]): OptionItem[] => values.map((value) => ({ id: value, value }));

export const GENRE_OPTIONS: OptionItem[] = toOptions([
  "Action",
  "Adult",
  "Adventure",
  "Comedy",
  "Doujinshi",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Gender Bender",
  "Harem",
  "Hentai",
  "Historical",
  "Horror",
  "Josei",
  "Lolicon",
  "Martial Arts",
  "Mature",
  "Mecha",
  "Mystery",
  "Psychological",
  "Romance",
  "School Life",
  "Sci-fi",
  "Seinen",
  "Shotacon",
  "Shoujo",
  "Shoujo Ai",
  "Shounen",
  "Shounen Ai",
  "Slice of Life",
  "Smut",
  "Sports",
  "Supernatural",
  "Tragedy",
  "Yaoi",
  "Yuri",
]);

export const TYPE_OPTIONS: OptionItem[] = toOptions([
  "Manga",
  "Manhwa",
  "Manhua",
  "One-shot",
  "Doujinshi",
  "Novel",
  "Comics",
  "Other",
]);

export const STATUS_OPTIONS: OptionItem[] = toOptions([
  "Ongoing",
  "Completed",
  "Hiatus",
  "Cancelled",
  "Announced",
]);

/** Catalog sort keys, in the order the sort picker offers them. */
export const SORT_OPTIONS = [
  { id: "real_views", label: "Popularity" },
  { id: "updated_at", label: "Recently Updated" },
  { id: "created_at", label: "Newest" },
  { id: "rating", label: "Rating" },
  { id: "votes", label: "Votes" },
  { id: "likes", label: "Likes" },
  { id: "chapters", label: "Chapter Count" },
  { id: "by_views", label: "Views" },
] as const;
