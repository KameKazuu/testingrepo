/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

// Kagane serves everything from a JSON API (yuzuki.kagane.to/api/v2); the
// website (kagane.to) is only used for the Referer header and share URLs.
//
// The whole zone sits behind Cloudflare with active bot management, so the API
// intermittently answers a "Just a moment" challenge instead of JSON. That is
// handled in network.ts by throwing CloudflareError so Paperback opens the
// bypass WebView. The API itself carries no auth beyond the Cloudflare
// clearance cookie — page images are the only signed requests (a per-book
// `?token=` JWT handed back by the book endpoint).

import type { JSONObject } from "@paperback/types";

/** Reader-facing website — used for share URLs and the Referer header. */
export const DEFAULT_DOMAIN = "https://kagane.to";

/** JSON API origin. Every listing/detail/page request goes here. */
export const DEFAULT_API_URL = "https://yuzuki.kagane.to/api/v2";

/** Persisted-settings keys. */
export const BASE_URL_KEY = "kagane.baseUrlOverride";
export const API_URL_KEY = "kagane.apiUrlOverride";
export const DATA_SAVER_KEY = "kagane.dataSaver";

// One UA for every request class (API, images, WebView, and the Cloudflare
// bypass) — cf_clearance cookies are bound to the exact UA string, so mixing
// agents invalidates a solved challenge.
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/138.0.0.0 Safari/537.36";

// Series listing page size (Spring-Data `content` envelope; `page` is 0-based).
export const SERIES_PAGE_SIZE = 30;

// ---------------------------------------------------------------------------
// Endpoint paths (relative to the API origin)
//
// CONFIRMED from captured traffic: `books/{id}` (returns access_token +
// cache_url + manifest) and the page-image URL format (see buildPageUrl).
// The others are reconstructed from the site's URL shapes and the response
// payloads; each is isolated here so a single edit corrects it if the live
// path differs.
// ---------------------------------------------------------------------------

/** Text search + browse feed. Returns `{ content: SeriesDto[] }`. */
export const SEARCH_PATH = "search/series";
/** Single-series detail: `series/{seriesId}`. */
export const SERIES_PATH = "series";
/** Per-series chapter (book) list: `series/{seriesId}/chapters`. */
export const CHAPTERS_SUBPATH = "chapters";
/** Per-book reader payload: `books/{bookId}` (+ `?is_datasaver=`). CONFIRMED. */
export const BOOKS_PATH = "books";
/** Genre/tag taxonomy list. Returns `GenreDto[]`. */
export const GENRE_PATH = "genre";

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
  /** UUID references into the genre taxonomy (resolved via GENRE_PATH). */
  genres?: string[] | null;
  /** UUID references into a separate tag taxonomy (names not exposed). */
  tags?: string[] | null;
  staff?: string[] | null;
  groups?: string[] | null;
  original_language?: string | null;
  translated_language?: string | null;
  latest_chapters?: BookDto[] | null;
}

/** A chapter/book, both in `latest_chapters` and the chapter-list endpoint. */
export interface BookDto {
  book_id: string;
  title?: string | null;
  chapter_no?: string | null;
  volume_no?: string | null;
  created_at?: string | null;
  available_at?: string | null;
}

/** Some list endpoints wrap books in a Spring-Data page too. */
export interface BookPageDto {
  content?: BookDto[] | null;
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

/** A genre/tag taxonomy entry from GENRE_PATH. */
export interface GenreDto {
  id: string;
  genre_name: string;
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
 * Page image URL. CONFIRMED format:
 *   {cache_url}/api/v2/books/page/{bookId}/{pageId}.{ext}?token={accessToken}
 */
export function buildPageUrl(
  cacheUrl: string,
  bookId: string,
  page: PageDto,
  token: string,
): string {
  const base = cacheUrl.replace(/\/+$/, "");
  return `${base}/api/v2/books/page/${bookId}/${page.page_id}.${page.ext}?token=${token}`;
}

// Series cover URL. INFERRED — `cover_image_id` is a UUID and the exact image
// route was not in the captured traffic. If covers render blank in-app, adjust
// this single function to the real path (grab one cover request from the site).
export function buildCoverUrl(apiUrl: string, coverImageId?: string | null): string {
  if (!coverImageId) return "";
  const base = apiUrl.replace(/\/+$/, "");
  return `${base}/images/${coverImageId}`;
}
