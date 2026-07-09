/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type SortingOption } from "@paperback/types";

export const DOMAIN = "https://allmanga.to";
export const MIRROR_HOSTS = ["allmanga.to", "mkissa.to"];
export const API_URL = "https://api.allanime.day/api";

// allmanga.to and mkissa.to are the same site on two domains. The reader is
// loaded from a chosen mirror, with the other as an automatic fallback. Default
// to allmanga.to: it is served 200 with no Cloudflare and boots via classic
// <script> tags, whereas mkissa.to sits behind an interactive Cloudflare
// challenge and is a SvelteKit app whose dynamic imports may not run inside the
// injected-HTML WebView.
export const PAGE_HOSTS = ["https://allmanga.to", "https://mkissa.to"];
export const MIRROR_KEY = "allmanga-mirror";
export const MIRROR_DEFAULT = "https://allmanga.to";

// The reader mirror the user picked in settings (defaults to the one that
// currently works without a Cloudflare prompt).
export function getPreferredMirror(): string {
  const value = Application.getState(MIRROR_KEY);
  return typeof value === "string" && PAGE_HOSTS.includes(value) ? value : MIRROR_DEFAULT;
}

// Preferred mirror first, the remaining mirror(s) as fallback.
export function pageHostOrder(): string[] {
  const preferred = getPreferredMirror();
  return [preferred, ...PAGE_HOSTS.filter((host) => host !== preferred)];
}

// The current build (mkissa.to) is the one that inlines window.__aaCrypto; the
// legacy allmanga.to shell doesn't ship it. Scrape the signing key from mkissa
// first regardless of the user's reader mirror, falling back to the other host
// only if the site ever moves it.
export const CRYPTO_HOST = "https://mkissa.to";

export function cryptoHostOrder(): string[] {
  return [CRYPTO_HOST, ...PAGE_HOSTS.filter((host) => host !== CRYPTO_HOST)];
}

export const THUMBNAIL_CDN = "https://wp.youtube-anime.com/aln.youtube-anime.com/";
export const IMAGE_CDN = "https://wp.youtube-anime.com";
export const DEFAULT_IMAGE_SERVER = "https://ytimgf.youtube-anime.com/";

export const LIMIT = 20;

export const IMAGE_QUALITY_KEY = "allmanga-image-quality";
export const SHOW_ADULT_KEY = "allmanga-show-adult";
export const IMAGE_QUALITY_DEFAULT = "original";

export const SECTION_POPULAR = "popular";
export const SECTION_POPULAR_WEEK = "popular_week";
export const SECTION_POPULAR_MONTH = "popular_month";
export const SECTION_LATEST = "latest";
export const SECTION_RECOMMENDED = "recommended";
export const SECTION_GENRES = "genres";

export type PageMetadata = {
  page?: number;
};

export type SearchMetadata = {
  country?: string[];
  genres?: Record<string, "included" | "excluded">;
};

export type OptionItem = {
  id: string;
  value: string;
};

export const POPULAR_QUERY = `query($type: VaildPopularTypeEnumType!, $size: Int!, $page: Int, $dateRange: Int, $allowAdult: Boolean, $allowUnknown: Boolean) {
  queryPopular(type: $type, size: $size, dateRange: $dateRange, page: $page, allowAdult: $allowAdult, allowUnknown: $allowUnknown) {
    recommendations {
      anyCard { _id name thumbnail englishName nativeName score availableChapters }
      pageStatus { views }
    }
  }
}`;

export const RANDOM_QUERY = `query($format: String!, $allowAdult: Boolean) {
  queryRandomRecommendation(format: $format, allowAdult: $allowAdult) {
    _id name thumbnail englishName
  }
}`;

export const SEARCH_QUERY = `query($search: SearchInput, $size: Int, $page: Int, $translationType: VaildTranslationTypeMangaEnumType, $countryOrigin: VaildCountryOriginEnumType) {
  mangas(search: $search, limit: $size, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) {
    edges { _id name thumbnail englishName }
  }
}`;

export const LATEST_QUERY = `query($search: SearchInput, $size: Int, $page: Int, $translationType: VaildTranslationTypeMangaEnumType, $countryOrigin: VaildCountryOriginEnumType) {
  mangas(search: $search, limit: $size, page: $page, translationType: $translationType, countryOrigin: $countryOrigin) {
    edges { _id name thumbnail englishName availableChapters availableChaptersDetail lastChapterDate }
  }
}`;

export const DETAILS_QUERY = `query($id: String!) {
  manga(_id: $id) { _id name thumbnail description authors genres tags status altNames englishName }
}`;

export const CHAPTERS_QUERY = `query($id: String!, $showId: String!) {
  manga(_id: $id) { _id name availableChaptersDetail }
  episodeInfos(showId: $showId, episodeNumStart: 0, episodeNumEnd: 9999) { episodeIdNum notes uploadDates }
}`;

// chapterPages requires a non-null $limit (it paginates over page *sources*, not
// individual pages); omitting it makes the server resolver return null. The site
// sends limit 10, offset 0.
//
// The nested `manga { countryOfOrigin }` is required too: the server resolver
// unconditionally assigns manga.countryOfOrigin but only creates that container
// when the field is selected — omit it and the resolver throws
// "Cannot set properties of undefined (setting 'countryOfOrigin')" → null pages.
export const PAGES_QUERY = `query($mangaId: String!, $translationType: VaildTranslationTypeMangaEnumType!, $chapterString: String!, $limit: Int!, $offset: Int) {
  chapterPages(mangaId: $mangaId, translationType: $translationType, chapterString: $chapterString, limit: $limit, offset: $offset) {
    edges { pictureUrlHead pictureUrls }
    manga { _id countryOfOrigin }
  }
}`;

export const PAGE_SOURCE_LIMIT = 10;

// Apollo persisted-query id for the chapterPages query above, observed on live
// api.allanime.day requests. The API serves pages to a direct client that sends
// this hash (no browser anti-bot signature required), so we try it before the
// WebView. Only changes if the site changes the query text.
export const CHAPTER_PAGES_HASH =
  "fe1f609dfea8a85618039516b01aa5c7979e9b13d5f3a2a7aaa31d09e5af0d51";

// The API sometimes returns the payload AES-GCM-encrypted in a `tobeparsed`
// field instead of plaintext; this is the key-derivation prefix the site uses
// (key = SHA-256("Xot36i3lK3:v" + versionByte)).
export const TOBEPARSED_KEY_PREFIX = "Xot36i3lK3:v";

export interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

export interface DateParts {
  year?: number | null;
  month?: number | null;
  date?: number | null;
  hour?: number | null;
  minute?: number | null;
  second?: number | null;
}

export interface MangaCard {
  _id: string;
  name: string;
  thumbnail?: string | null;
  englishName?: string | null;
  nativeName?: string | null;
  score?: number | null;
  availableChapters?: { sub?: number | null } | null;
  availableChaptersDetail?: AvailableChaptersDetail | null;
  lastChapterDate?: { sub?: DateParts | null } | null;
}

export interface PopularData {
  queryPopular: {
    recommendations: {
      anyCard?: MangaCard | null;
      pageStatus?: { views?: string | null } | null;
    }[];
  };
}

export interface SearchData {
  mangas: { edges: MangaCard[] };
}

export interface RandomData {
  queryRandomRecommendation?: MangaCard[] | null;
}

export interface MangaDetail {
  _id: string;
  name: string;
  thumbnail?: string | null;
  description?: string | null;
  authors?: string[] | null;
  genres?: string[] | null;
  tags?: string[] | null;
  status?: string | null;
  altNames?: string[] | null;
  englishName?: string | null;
}

export interface DetailsData {
  manga: MangaDetail;
}

export interface AvailableChaptersDetail {
  sub?: string[];
}

export interface EpisodeInfo {
  episodeIdNum: number | string;
  notes?: string | null;
  uploadDates?: { sub?: string | null } | null;
}

export interface ChaptersData {
  manga: {
    _id: string;
    name: string;
    availableChaptersDetail?: AvailableChaptersDetail | null;
  };
  episodeInfos?: EpisodeInfo[] | null;
}

export type PictureUrl = string | { url?: string | null };

export interface ChapterPageEdge {
  pictureUrlHead?: string | null;
  pictureUrls?: PictureUrl[] | null;
}

export interface PagesData {
  chapterPages?: { edges: ChapterPageEdge[] } | null;
}

export const SORTING_OPTIONS: SortingOption[] = [
  { id: "", label: "Update" },
  { id: "Name_ASC", label: "Name Ascending" },
  { id: "Name_DESC", label: "Name Descending" },
];

export const COUNTRY_OPTIONS: OptionItem[] = [
  { id: "ALL", value: "All" },
  { id: "JP", value: "Japan" },
  { id: "CN", value: "China" },
  { id: "KR", value: "Korea" },
];

export const GENRE_OPTIONS: string[] = [
  "4 Koma",
  "Action",
  "Adult",
  "Adventure",
  "Cars",
  "Comedy",
  "Cooking",
  "Crossdressing",
  "Dementia",
  "Demons",
  "Doujinshi",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Game",
  "Gender Bender",
  "Gyaru",
  "Harem",
  "Historical",
  "Horror",
  "Isekai",
  "Josei",
  "Kids",
  "Loli",
  "Magic",
  "Manhua",
  "Manhwa",
  "Martial Arts",
  "Mature",
  "Mecha",
  "Medical",
  "Military",
  "Monster Girls",
  "Music",
  "Mystery",
  "One Shot",
  "Parody",
  "Police",
  "Post Apocalyptic",
  "Psychological",
  "Reincarnation",
  "Reverse Harem",
  "Romance",
  "Samurai",
  "School",
  "Sci-Fi",
  "Seinen",
  "Shota",
  "Shoujo",
  "Shoujo Ai",
  "Shounen",
  "Shounen Ai",
  "Slice of Life",
  "Smut",
  "Space",
  "Sports",
  "Super Power",
  "Supernatural",
  "Suspense",
  "Thriller",
  "Tragedy",
  "Unknown",
  "Vampire",
  "Webtoons",
  "Yaoi",
  "Youkai",
  "Yuri",
  "Zombies",
];

export function genreId(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "_");
}

export const GENRE_NAME_BY_ID: Record<string, string> = Object.fromEntries(
  GENRE_OPTIONS.map((name) => [genreId(name), name]),
);
