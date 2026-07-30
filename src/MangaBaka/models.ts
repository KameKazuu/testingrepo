/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export const DOMAIN = "https://mangabaka.org";
export const API_URL = "https://api.mangabaka.org";

export const TOKEN_KEY = "mangabaka-token";
export const SEARCH_LIMIT = 20;
export const DISCOVER_LIMIT = 20;

// The library `state` values the API accepts, in the order they are offered.
export const LIBRARY_STATES = [
  { id: "reading", title: "Reading" },
  { id: "plan_to_read", title: "Plan to Read" },
  { id: "completed", title: "Completed" },
  { id: "paused", title: "Paused" },
  { id: "dropped", title: "Dropped" },
  { id: "rereading", title: "Rereading" },
  { id: "considering", title: "Considering" },
];

// Ratings are stored 0-100 but presented on the usual 0-10 scale.
export const RATING_SCALE = 10;

export interface Pagination {
  count?: number | null;
  page?: number | null;
  limit?: number | null;
  next?: number | null;
  previous?: number | null;
}

export interface Envelope<T> {
  status?: string;
  data: T;
}

export interface PagedEnvelope<T> extends Envelope<T[]> {
  pagination?: Pagination | null;
}

export interface SeriesTitle {
  language?: string | null;
  title?: string | null;
  is_primary?: boolean | null;
}

export interface SeriesCover {
  raw?: string | null;
  x150?: string | null;
  x250?: string | null;
  x350?: string | null;
}

export interface Series {
  id: number;
  titles?: SeriesTitle[] | null;
  cover?: SeriesCover | null;
  description?: string | null;
  authors?: string[] | null;
  artists?: string[] | null;
  publishers?: string[] | null;
  tags?: string[] | null;
  status?: string | null;
  type?: string | null;
  content_rating?: string | null;
  rating?: number | null;
  total_chapters?: number | null;
  final_volume?: number | null;
}

export interface LibraryEntry {
  id?: number | null;
  series_id?: number | null;
  state?: string | null;
  rating?: number | null;
  progress_chapter?: number | null;
  progress_volume?: number | null;
  number_of_rereads?: number | null;
  is_private?: boolean | null;
  note?: string | null;
}

export interface Profile {
  id?: number | null;
  nickname?: string | null;
  preferred_username?: string | null;
}
