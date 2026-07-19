/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

// Kagane serves everything from a same-origin JSON API (kagane.to/api/v2);
// page images come from a separate CDN (kstatic.to) authorised by a per-book
// `?token=` JWT the book endpoint hands back.
//
// The whole zone sits behind Cloudflare with active bot management, so the API
// intermittently answers a "Just a moment" challenge instead of JSON. That is
// handled in network.ts by throwing CloudflareError so Paperback opens the
// bypass WebView. The API itself carries no auth beyond the Cloudflare
// clearance cookie.

import type { JSONObject } from "@paperback/types";

/** Website origin — also the API origin (the API is same-origin under /api/v2). */
export const DEFAULT_DOMAIN = "https://kagane.to";

/** JSON API base. CONFIRMED from captured traffic. */
export const DEFAULT_API_URL = "https://kagane.to/api/v2";

/** Persisted-settings keys. */
export const BASE_URL_KEY = "kagane.baseUrlOverride";
export const API_URL_KEY = "kagane.apiUrlOverride";
export const DATA_SAVER_KEY = "kagane.dataSaver";

// The extension pins no User-Agent: every request uses the device's own UA
// (Application.getDefaultUserAgent) so it matches the Cloudflare-bypass
// WebView. cf_clearance is UA-bound, so a mismatched UA loops the challenge.

// Series listing page size (Spring-Data `content` envelope; `page` is 0-based).
export const SERIES_PAGE_SIZE = 30;

// ---------------------------------------------------------------------------
// Endpoint paths (relative to the API base)
//
// CONFIRMED from captured traffic:
//   POST search/series?page=&size=  (JSON body: { title, content_rating, … })
//   GET  tags/list                  (taxonomy for the filter UI)
//   GET  books/{id}?is_datasaver=   (access_token + cache_url + manifest)
//   page-image URL format           (see buildPageUrl)
// The rest are reconstructed from the site's URL shapes; each is isolated
// here so a single edit corrects it if a live path differs.
// ---------------------------------------------------------------------------

/** Text search + browse feed. POST; returns `{ content: SeriesDto[] }`. CONFIRMED. */
export const SEARCH_PATH = "search/series";
/**
 * Single-series detail: `series/{seriesId}`. The response embeds the full
 * chapter list under `series_books`, so there is no separate chapters call.
 */
export const SERIES_PATH = "series";
/** Per-book reader payload: POST `books/{bookId}?is_datasaver=`. CONFIRMED. */
export const BOOKS_PATH = "books";
/**
 * Genre taxonomy list (the curated genre/theme/demographic axis used by the
 * filter UI and to resolve a series' `genres[]` UUIDs to names). The parallel
 * `tags/list` is deliberately not fetched: it is a multi-megabyte dump of
 * free-form hashtags this extension never resolves. The fetch is
 * failure-tolerant, so a wrong candidate path just leaves genres unnamed.
 */
export const GENRE_PATH = "genres/list";

/** POST search/series genre filter. CONFIRMED: { values, match_all }. */
export interface GenreFilter extends JSONObject {
  values: string[];
  match_all: boolean;
}

/** JSON body for POST search/series (only the fields this extension sends). */
export interface SearchBody extends JSONObject {
  title?: string;
  genres?: GenreFilter;
}

// ---------------------------------------------------------------------------
// API response DTOs (only the fields this extension consumes)
// ---------------------------------------------------------------------------

/** `search/series` envelope (Spring-Data page). */
export interface SeriesPageDto {
  content?: SeriesDto[] | null;
  page?: number | null;
  size?: number | null;
  total_pages?: number | null;
  total_elements?: number | null;
}

/** A series as returned by the listing and detail endpoints. */
export interface SeriesDto {
  series_id: string;
  title: string;
  description?: string | null;
  alternate_titles?: string[] | null;
  cover_image_id?: string | null;
  content_rating?: string | null;
  publication_status?: string | null;
  upload_status?: string | null;
  format?: string | null;
  start_year?: number | null;
  end_year?: number | null;
  current_books?: number | null;
  current_volumes?: number | null;
  /** UUID references into the genre taxonomy (resolved via TAXONOMY_PATHS). */
  genres?: string[] | null;
  /** UUID references into a separate tag taxonomy (names not exposed). */
  tags?: string[] | null;
  staff?: string[] | null;
  groups?: string[] | null;
  original_language?: string | null;
  translated_language?: string | null;
  /** Newest book, present on listing entries (search feed). */
  latest_chapters?: BookDto[] | null;
}

/** A chapter/book, in `latest_chapters` (feed) and `series_books` (detail). */
export interface BookDto {
  book_id: string;
  title?: string | null;
  chapter_no?: string | null;
  volume_no?: string | null;
  /** Canonical ordering key on detail books (higher = later). */
  sort_no?: number | null;
  created_at?: string | null;
  available_at?: string | null;
  became_visible_at?: string | null;
}

// ---------------------------------------------------------------------------
// Series-detail response (`series/{id}`) — a distinct shape from the listing:
// the cover lives under `series_covers`, and genres/tags/staff arrive as named
// objects rather than bare UUIDs (so details need no taxonomy lookup).
// ---------------------------------------------------------------------------

export interface SeriesDetailDto {
  series_id: string;
  title: string;
  description?: string | null;
  content_rating?: string | null;
  publication_status?: string | null;
  format?: string | null;
  translated_language?: string | null;
  series_covers?: CoverDto[] | null;
  series_alternate_titles?: AltTitleDto[] | null;
  genres?: NamedRefDto[] | null;
  tags?: NamedRefDto[] | null;
  series_staff?: StaffDto[] | null;
  series_books?: BookDto[] | null;
}

export interface CoverDto {
  image_id?: string | null;
  language?: string | null;
  chapter_number?: string | null;
}

export interface AltTitleDto {
  title?: string | null;
  label?: string | null;
}

export interface NamedRefDto {
  genre_id?: string | null;
  genre_name?: string | null;
  tag_id?: string | null;
  tag_name?: string | null;
  is_spoiler?: boolean | null;
}

export interface StaffDto {
  name?: string | null;
  role?: string | null;
}

/** `books/{id}` reader payload. CONFIRMED shape. */
export interface ReaderDto {
  /** JWT bound to the book; passed as `?token=` on every page image. */
  access_token: string;
  /** Image CDN origin, e.g. https://kstatic.to. */
  cache_url: string;
  manifest?: ManifestDto | null;
}

export interface ManifestDto {
  pages?: PageDto[] | null;
  version?: number | null;
}

export interface PageDto {
  page_id: string;
  page_no: number;
  ext: string;
  width?: number | null;
  height?: number | null;
}

/** A genre taxonomy entry from GENRE_PATH. */
export interface GenreDto {
  id: string;
  genre_name?: string | null;
  name?: string | null;
  /** genre / theme / demographic / format axis. */
  genre_type?: string | null;
}

// ---------------------------------------------------------------------------
// Discover / search metadata
// ---------------------------------------------------------------------------

/** Pagination cursor for `PagedResults` (0-based, matching the API). */
export interface Metadata extends JSONObject {
  page: number;
}

/** Advanced-search selections. Genre values are taxonomy UUIDs. */
export type SearchMetadata = {
  genres?: string[];
};

export interface OptionItem {
  id: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Image URL builders
// ---------------------------------------------------------------------------

/**
 * Page image URL. CONFIRMED format (data saver inserts a `datasaver` segment):
 *   {cache_url}/api/v2/books/page[/datasaver]/{bookId}/{pageId}.{ext}?token=…
 */
export function buildPageUrl(
  cacheUrl: string,
  bookId: string,
  page: PageDto,
  token: string,
  dataSaver: boolean,
): string {
  const base = cacheUrl.replace(/\/+$/, "");
  const saver = dataSaver ? "/datasaver" : "";
  return `${base}/api/v2/books/page${saver}/${bookId}/${page.page_id}.${page.ext}?token=${token}`;
}

/** Series cover URL. CONFIRMED: {api}/image/{coverImageId}/compressed. */
export function buildCoverUrl(apiUrl: string, coverImageId?: string | null): string {
  if (!coverImageId) return "";
  const base = apiUrl.replace(/\/+$/, "");
  return `${base}/image/${coverImageId}/compressed`;
}
