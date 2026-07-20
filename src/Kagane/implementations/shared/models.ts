/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SortingOption } from "@paperback/types";

export const BASE_URL = "https://kagane.to";
export const API_URL = BASE_URL;
export const DEFAULT_CACHE_URL = "https://kstatic.to";
export const PAGE_SIZE = 35;

export const METADATA_CACHE_KEY = "kagane-metadata-cache";
export const METADATA_CACHE_DATE_KEY = "kagane-metadata-cache-date";
export const METADATA_CACHE_TTL_SECONDS = 24 * 60 * 60;
export const TAGS_CACHE_KEY = "kagane-tags-cache";
export const TAGS_CACHE_DATE_KEY = "kagane-tags-cache-date";
export const INTEGRITY_TOKEN_KEY = "kagane-integrity-token";
export const INTEGRITY_EXP_KEY = "kagane-integrity-exp";

export const CONTENT_RATING_KEY = "kagane-content-rating";
export const POPULAR_TIME_SPAN_KEY = "kagane-popular-time-span";
export const SOURCE_DISPLAY_MODE_KEY = "kagane-source-display-mode";
export const SHOW_EDITION_KEY = "kagane-show-edition";
export const SHOW_SOURCE_KEY = "kagane-show-source";
export const SHOW_SPOILER_TAGS_KEY = "kagane-show-spoiler-tags";
export const DATA_SAVER_KEY = "kagane-data-saver";
export const CHAPTER_TITLE_MODE_KEY = "kagane-chapter-title-mode";
export const EXCLUDED_GENRES_KEY = "kagane-excluded-genres";
export const CONTENT_LANGUAGES_KEY = "kagane-content-languages";
export const HIDDEN_FORMATS_KEY = "kagane-hidden-formats";
export const HIDDEN_TAG_CATEGORIES_KEY = "kagane-hidden-tag-categories";
export const CUSTOM_HIDDEN_TAGS_KEY = "kagane-custom-hidden-tags";

export const CONTENT_RATING_VALUES = ["safe", "suggestive", "erotica", "pornographic"] as const;
export type KaganeContentRating = (typeof CONTENT_RATING_VALUES)[number];

export const CONTENT_RATING_OPTIONS: Array<{ id: KaganeContentRating; title: string }> = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
];

export const SOURCE_DISPLAY_MODE_OPTIONS = [
  { id: "all", title: "All Uploads" },
  { id: "official", title: "Official Only" },
  { id: "scanlations", title: "Scanlations Only" },
];

export const CHAPTER_TITLE_MODE_OPTIONS = [
  { id: "optional", title: "Title Only" },
  { id: "always", title: "Ch.X + Title" },
  { id: "vol_chapter", title: "Vol.X Ch.Y + Title" },
];

export const LANGUAGE_OPTIONS = [
  { id: "en", title: "English" },
  { id: "ja", title: "Japanese" },
  { id: "ko", title: "Korean" },
  { id: "zh-Hans", title: "Chinese Simplified" },
  { id: "zh-Hant", title: "Chinese Traditional" },
  { id: "es", title: "Spanish" },
  { id: "es-419", title: "Spanish Latin America" },
  { id: "fr", title: "French" },
  { id: "de", title: "German" },
  { id: "pt", title: "Portuguese" },
  { id: "pt-BR", title: "Portuguese Brazil" },
  { id: "ru", title: "Russian" },
  { id: "it", title: "Italian" },
  { id: "id", title: "Indonesian" },
  { id: "vi", title: "Vietnamese" },
  { id: "th", title: "Thai" },
  { id: "pl", title: "Polish" },
  { id: "hi", title: "Hindi" },
  { id: "ar", title: "Arabic" },
];

export const FORMAT_OPTIONS = ["Manga", "Manhwa", "Manhua", "Comic", "Other"];

/**
 * Preset hide-lists for sensitive tag families. Each category maps to the
 * Kagane tag taxonomy UUIDs it covers, so hiding a category excludes every
 * variant tag in one tap.
 */
export const HIDDEN_TAG_CATEGORIES: Array<{ id: string; title: string; tagIds: string[] }> = [
  {
    id: "boys_love",
    title: "Boys Love",
    tagIds: [
      "019da7d4-cff3-7601-88c7-e230067edb5f",
      "019c500a-3948-7bc1-a059-5308a3a6d620",
      "019dfd9e-f74e-77d2-ab56-0332a8e909ef",
      "019e3c55-1bc4-7e08-8127-e459337b06e6",
      "019c203b-da2b-7127-a5e9-f4b3e33996a7",
      "019c2065-eaa6-74f4-a460-a5b4034b5cdf",
      "019c2536-45c2-7afe-b456-7ca5500b6fe6",
      "019c29cc-4f80-73b0-879f-a1145c67f94d",
      "019dbae0-e7d2-7f6f-8691-f92d6298809e",
    ],
  },
  {
    id: "girls_love",
    title: "Girls Love",
    tagIds: [
      "019c3cbc-60bf-7cba-88e6-82243e7c9a96",
      "019dbaf6-5f71-73fb-a0e0-897289a63c4e",
      "019c2060-746d-7ccb-b6dd-7da20918e3e7",
      "019c207d-bdcb-77c6-9f4b-53015461d4aa",
      "019e4a5f-f787-76a1-9de5-a2ab433e554a",
    ],
  },
  {
    id: "incest",
    title: "Incest",
    tagIds: [
      "019c52d4-9e54-724e-a929-da42b6d42d42",
      "019c2530-abb9-7d0d-82bb-37a1683fecb5",
      "019c3407-81dd-78d5-83e3-257221709b14",
      "019c206e-5376-7f08-8b90-7833a5620c9d",
      "019c29c7-eab6-77d5-9450-574436e18d7b",
      "019c2045-518d-7bf4-a067-414dc9a054a6",
      "019c298d-19b6-745d-9b18-3db6b009f685",
      "019c2558-ed36-73a1-ae93-884b21e881f6",
      "019c2042-e4ac-76c2-af97-313b41617c18",
      "019c3cbe-1b1d-7bc9-aea9-65c7e77dcaf7",
      "019c254b-cb89-7810-86fa-431bbcf97983",
      "019c2091-d0c8-7ed4-8b2b-e586d9663bd9",
      "019c2071-7759-7dcf-8014-1689073ddb98",
      "019c291f-0dd9-76cc-a57e-c3735aa54d54",
      "019c2921-da37-79ad-b5d9-b08dd7847fe7",
      "019c680f-bb7d-78d0-8c95-2dd6339bef91",
      "019c2920-5620-799e-a2f9-2aa0823f8693",
      "019c2542-3702-7907-afb0-32ae6c1b6bf1",
      "019c2922-ee12-7a1b-bb71-87f7f19c3185",
    ],
  },
  {
    id: "netorare",
    title: "Netorare (NTR)",
    tagIds: [
      "019c2050-00e9-7e47-825d-a4397300eb00",
      "019c291f-66e1-7ff7-a444-e1a1b9370cd7",
      "019c2920-0908-7a38-8a92-4bde5d1301bf",
      "019c2925-6e05-706c-9311-d69e8dd54c1b",
      "019c2555-1694-7e49-8b29-08ae4de2c62e",
    ],
  },
  {
    id: "rape",
    title: "Rape / Sexual Assault",
    tagIds: [
      "019c2069-8616-7901-9af4-30fc5c445fdd",
      "019c2045-b1a0-7a54-925d-ec2999c29201",
      "019c2542-b056-7db2-b53b-a9ec113d828e",
      "019c2042-abcc-72c3-a98a-0ba8b07cb42b",
      "019c207a-354d-74ea-bd39-42b5e48a05a7",
      "019c2054-2144-7785-a831-09cc0441e51d",
      "019c206c-0dd8-781f-a4b2-aff954a94640",
      "019c253e-d363-7fe3-a173-3251a4c02b99",
      "019c2064-3ad6-717c-af64-6c29fe14a02b",
      "019c2532-56d0-7e82-8ee2-c905700e69b8",
      "019d5a9f-9555-7323-8935-6db2d2ef5335",
      "019c2045-518b-744f-9449-21c126c751ef",
      "019c2045-51af-772c-8861-338e0173ebe0",
      "019c680f-bb57-7943-acea-e6fca1fae863",
      "019c2532-05d4-78d5-90ab-596e3454c3eb",
      "019c2068-4640-73a6-9c7c-ec76d530b24a",
      "019c2082-2ce3-78ef-bfe1-744ef77c777d",
      "019c2050-c9be-7424-997c-054695622459",
      "019c2070-2a5f-7b16-bd46-25090c52f5fc",
      "019c2075-759f-7cd7-8fa3-9e19c4cc0dfa",
      "019c2045-5190-71cb-b9a6-13497669f3f6",
      "019c2984-fdb6-7b6c-8457-ba81c085280c",
    ],
  },
  {
    id: "bestiality",
    title: "Bestiality",
    tagIds: ["019c2092-70bf-7cc7-a550-5b4e4b5a9b57"],
  },
  {
    id: "lolicon",
    title: "Lolicon",
    tagIds: [
      "019c2047-5cd9-7106-84c6-0c9bfe6ed5aa",
      "019c27c7-01ba-7a6f-816d-c95364c54287",
      "019c2090-831e-79c1-b80b-6c3b7114d0fd",
      "019c27d2-1d93-7856-b141-3413f4548388",
      "019c27d2-1d98-7b25-9287-7efa863130eb",
    ],
  },
  {
    id: "shotacon",
    title: "Shotacon",
    tagIds: [
      "019c2922-bb20-7429-8b40-68d87d1a4e19",
      "019c27d2-1d96-75da-9347-0e50699df114",
      "019c27d6-e979-7c8c-bc0a-c3fa75c16ec7",
      "019c29a7-ea59-728c-b15b-63b010afb4e2",
      "019c253e-a039-7e8f-a369-891baf23605c",
      "019c254a-a23f-7ec7-b33e-fe39efb67158",
    ],
  },
];

export const PUBLICATION_STATUS_OPTIONS = [
  { id: "Ongoing", value: "Ongoing" },
  { id: "Completed", value: "Completed" },
  { id: "Abandoned", value: "Cancelled" },
  { id: "Hiatus", value: "Hiatus" },
];

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "relevance", label: "Relevance" },
  { id: "total_views,desc", label: "Popular (Total Views)" },
  { id: "avg_views,desc", label: "Popular (Average Views)" },
  { id: "avg_views_today,desc", label: "Popular (Today)" },
  { id: "avg_views_week,desc", label: "Popular (Week)" },
  { id: "avg_views_month,desc", label: "Popular (Month)" },
  { id: "updated_at,desc", label: "Latest" },
  { id: "series_name,desc", label: "Name (Z–A)" },
  { id: "books_count,desc", label: "Chapter Count" },
  { id: "created_at,desc", label: "Created At" },
];

export interface GenreDto {
  id: string;
  genre_name: string;
}

export interface TagDto {
  id: string;
  tag_name: string;
}

export interface SourcesDto {
  sources: SourceDto[];
}

export interface SourceDto {
  source_id: string;
  source_type: string;
  title: string;
}

export interface KaganeMetadata {
  genres: Record<string, string>;
  sources: SourceDto[];
}

export interface KaganeSearchResponse {
  content?: KaganeSearchSeries[];
  last?: boolean;
  total_elements?: number;
  total_pages?: number;
}

export interface KaganeSearchSeries {
  series_id: string;
  title: string;
  source_id?: string | null;
  current_books?: number;
  start_year?: number | null;
  cover_image_id?: string | null;
  alternate_titles?: string[];
  content_rating?: string | null;
  format?: string | null;
  publication_status?: string | null;
  translated_language?: string | null;
  /** Genre taxonomy UUIDs; resolved to names via KaganeMetadata.genres. */
  genres?: string[];
  latest_chapters?: LatestChapter[];
}

export interface LatestChapter {
  book_id: string;
  title?: string | null;
  chapter_no?: string | null;
  volume_no?: string | null;
  created_at?: string | null;
  available_at?: string | null;
}

/**
 * Trending time windows for the ranged discover chips. The id doubles as a
 * filter-option id, which forbids commas — the sort string lives alongside it.
 */
export const RANGE_OPTIONS = [
  { id: "today", title: "Today", sort: "avg_views_today,desc" },
  { id: "week", title: "This Week", sort: "avg_views_week,desc" },
  { id: "month", title: "This Month", sort: "avg_views_month,desc" },
];

export const SOURCE_TYPE_OPTIONS = ["Official", "Unofficial", "Mixed"];

/** The time window the Popular discover section ranks by. */
export const POPULAR_TIME_SPAN_OPTIONS = [
  { id: "today", title: "Today", sort: "avg_views_today,desc" },
  { id: "week", title: "This Week", sort: "avg_views_week,desc" },
  { id: "month", title: "This Month", sort: "avg_views_month,desc" },
  { id: "allTime", title: "All Time", sort: "total_views,desc" },
];

export interface KaganeSeriesDetailsResponse {
  title: string;
  description?: string | null;
  upload_status: string;
  publication_status?: string | null;
  content_rating?: string | null;
  translated_language?: string | null;
  format?: string | null;
  source_id?: string | null;
  series_staff?: SeriesStaff[];
  genres?: SeriesGenre[];
  tags?: SeriesTag[];
  series_alternate_titles?: AlternateTitle[];
  series_books?: ChapterBook[];
  edition_info?: string | null;
  tracker_id?: string | null;
  series_covers?: SeriesCover[];
  average_rating?: number | null;
  bayesian_rating?: number | null;
  total_views?: number | null;
}

export interface SeriesStaff {
  name: string;
  role: string;
}

export interface SeriesGenre {
  genre_id?: string;
  genre_name: string;
  is_spoiler?: boolean;
}

export interface SeriesTag {
  tag_id?: string;
  tag_name: string;
  is_spoiler?: boolean;
}

export interface AlternateTitle {
  title: string;
  label?: string | null;
}

export interface SeriesCover {
  image_id: string;
}

export interface ChapterBook {
  book_id: string;
  series_id?: string | null;
  title: string;
  created_at?: string | null;
  page_count?: number;
  sort_no: number;
  chapter_no?: string | null;
  volume_no?: string | null;
  groups?: Array<{ title: string }>;
}

export interface ChallengeDto {
  access_token: string;
  cache_url: string;
  manifest?: ManifestDto | null;
}

export interface ManifestDto {
  pages?: PageDto[];
}

export interface PageDto {
  page_no: number;
  page_id: string;
  ext?: string | null;
}

export interface IntegrityDto {
  token: string;
  exp: number;
}
