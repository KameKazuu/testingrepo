/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export const DOMAIN = "https://mangabaka.org";
export const API_URL = "https://api.mangabaka.org";

export const TOKEN_KEY = "mangabaka-token";
export const ACCESS_TOKEN_KEY = "mangabaka-access-token";
export const REFRESH_TOKEN_KEY = "mangabaka-refresh-token";
export const GENRES_CACHE_KEY = "mangabaka-genres";

// The search endpoint caps `limit` at 100 and `page` at 100.
export const SEARCH_LIMIT = 20;
export const SEARCH_MAX_PAGE = 100;

// The library endpoints bound chapter and volume progress at ten thousand.
export const PROGRESS_MAX = 10000;

// The discover endpoints cap their own list at twenty; the search rows are
// asked for the same number so every row is the same length.
export const DISCOVER_LIMIT = 20;

export const OAUTH_AUTHORIZE_URL = "https://mangabaka.org/auth/oauth2/authorize";
export const OAUTH_TOKEN_URL = "https://mangabaka.org/auth/oauth2/token";
export const OAUTH_CLIENT_ID = "GErkDQIdfFFQiBRlNmxgcDNFrQtrcHiE";
export const OAUTH_REDIRECT_URI = "paperback://mangabaka-login";
export const OAUTH_SCOPES = [
  "openid",
  "profile",
  "library.read",
  "library.write",
  "offline_access",
];

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

// Ratings are stored 0-100. `rating_steps` on the account is the increment the
// account stores them in, so a 0-10 picker has to step by a tenth of it.
export const RATING_SCALE = 10;
export const RATING_STEPS_KEY = "mangabaka-rating-steps";
export const DEFAULT_RATING_STEPS = 1;

// Every option below is an enum the search endpoint documents; sending anything
// else is rejected with a 400.
export const SERIES_TYPES = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "novel", title: "Novel" },
  { id: "oel", title: "OEL" },
  { id: "other", title: "Other" },
];

export const SERIES_STATUSES = [
  { id: "releasing", title: "Releasing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
  { id: "upcoming", title: "Upcoming" },
  { id: "unknown", title: "Unknown" },
];

export const TAG_MODES = [
  { id: "and", title: "Match All" },
  { id: "or", title: "Match Any" },
];

export const CONTENT_RATINGS = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const SORT_OPTIONS = [
  { id: "relevance_desc", label: "Relevance" },
  { id: "relevance_asc", label: "Relevance (ascending)" },
  { id: "trending_7d", label: "Trending (7 days)" },
  { id: "trending_30d", label: "Trending (30 days)" },
  // Popularity is a rank, where one is the most popular, so the ascending
  // order is the flattering one.
  { id: "popularity_asc", label: "Most Popular" },
  { id: "popularity_desc", label: "Least Popular" },
  { id: "score_desc", label: "Highest Rated" },
  { id: "score_asc", label: "Lowest Rated" },
  { id: "latest", label: "Recently Updated" },
  { id: "published_start_date_desc", label: "Newest" },
  { id: "published_start_date_asc", label: "Oldest" },
  { id: "published_end_date_desc", label: "Ended Most Recently" },
  { id: "published_end_date_asc", label: "Ended Earliest" },
  { id: "published_year_desc", label: "Year (newest first)" },
  { id: "published_year_asc", label: "Year (oldest first)" },
  { id: "chapters_desc", label: "Most Chapters" },
  { id: "chapters_asc", label: "Fewest Chapters" },
  { id: "volumes_desc", label: "Most Volumes" },
  { id: "volumes_asc", label: "Fewest Volumes" },
  { id: "random", label: "Random" },
];

// Carried in `SearchQuery.metadata`, so it has to stay plain JSON. Every
// filter the endpoint takes has a matching negative form, so each one is kept
// as an included and an excluded list.
export type SearchFilters = {
  // Genres are tags carrying `is_genre`, so they travel on the tag
  // parameters.
  genres?: string[];
  excludeGenres?: string[];
  tagMode?: string;
  types?: string[];
  excludeTypes?: string[];
  statuses?: string[];
  excludeStatuses?: string[];
  contentRatings?: string[];
  excludeContentRatings?: string[];
  licensedOnly?: boolean;
};

export interface Pagination {
  count?: number | null;
  page?: number | null;
  limit?: number | null;
  // Both are the full URL of that page, or null when there is none.
  next?: string | null;
  previous?: string | null;
}

export interface Envelope<T> {
  status?: number;
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

// A row of `/v1/tags`. Names are documented as unstable, so the numeric id is
// what the search parameters are given.
export interface TagDefinition {
  id: number;
  name: string;
  is_genre?: boolean | null;
  merged_with?: number | null;
  series_count?: number | null;
}

export interface SeriesTag {
  id?: number | null;
  name?: string | null;
  is_genre?: boolean | null;
}

export interface SeriesPublisher {
  name?: string | null;
  type?: string | null;
  note?: string | null;
}

export interface Series {
  id: number;
  titles?: SeriesTitle[] | null;
  cover?: SeriesCover | null;
  description?: string | null;
  authors?: string[] | null;
  artists?: string[] | null;
  publishers?: SeriesPublisher[] | null;
  // Only returned by the `full` schema.
  tags?: SeriesTag[] | null;
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
  id?: string | null;
  nickname?: string | null;
  preferred_username?: string | null;
  auth_type?: string | null;
  rating_steps?: number | null;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string | null;
}
