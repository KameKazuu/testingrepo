/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export const DOMAIN = "https://mangabaka.org";
export const API_URL = "https://api.mangabaka.org";

export const TOKEN_KEY = "mangabaka-token";
export const ACCESS_TOKEN_KEY = "mangabaka-access-token";
export const REFRESH_TOKEN_KEY = "mangabaka-refresh-token";

export const SEARCH_LIMIT = 20;

// Endpoints come from https://mangabaka.org/.well-known/openid-configuration.
export const OAUTH_TOKEN_URL = "https://mangabaka.org/auth/oauth2/token";
export const OAUTH_CLIENT_ID = "GErkDQIdfFFQiBRlNmxgcDNFrQtrcHiE";
export const OAUTH_REDIRECT_URI = "paperback://mangabaka-login";

// The scope list travels in the authorize URL rather than the row's `scopes`
// property, which is how the other OAuth extensions pass it.
export const OAUTH_AUTHORIZE_URL =
  "https://mangabaka.org/auth/oauth2/authorize" +
  "?scope=openid+profile+library.read+library.write+offline_access";

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

// Ratings are stored 0-100 but presented on the usual 0-10 scale. How many
// steps that scale is divided into is a per-account setting, so the score
// picker has to match it or it offers values the account cannot store.
export const RATING_SCALE = 10;
export const RATING_STEPS_KEY = "mangabaka-rating-steps";
export const DEFAULT_RATING_STEPS = 10;

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
  rating_steps?: number | null;
}
