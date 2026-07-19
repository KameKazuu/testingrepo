/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";

import {
  buildCoverUrl,
  buildPageUrl,
  type BookDto,
  type ReaderDto,
  type SeriesDetailDto,
  type SeriesDto,
} from "./models";

// ---------------------------------------------------------------------------
// field helpers
// ---------------------------------------------------------------------------

// Content-rating string → Paperback rating. Kagane uses "Safe" / "Suggestive"
// and stronger tiers; keep the stricter interpretation so adult titles aren't
// shown to readers who hide those categories.
export function mapContentRating(rating?: string | null): ContentRating {
  switch ((rating ?? "").toLowerCase()) {
    case "safe":
      return ContentRating.EVERYONE;
    case "suggestive":
    case "mature":
      return ContentRating.MATURE;
    case "erotica":
    case "explicit":
    case "pornographic":
    case "hentai":
    case "adult":
      return ContentRating.ADULT;
    default:
      return ContentRating.EVERYONE;
  }
}

// Publication-status string → Paperback status label.
export function mapStatus(status?: string | null): string {
  switch ((status ?? "").toLowerCase()) {
    case "ongoing":
    case "releasing":
      return "Ongoing";
    case "completed":
      return "Completed";
    case "hiatus":
      return "Hiatus";
    case "cancelled":
    case "canceled":
      return "Cancelled";
    case "dropped":
      return "Dropped";
    default:
      return "Unknown";
  }
}

// Timestamps arrive ISO-8601 with an offset ("2026-07-18T18:35:24.939888+00:00");
// pass them straight to Date, guarding against unparseable values.
export function parseDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function chapterNumberValue(raw?: string | null): number {
  if (!raw) return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

export function formatChapterNumber(raw?: string | null): string {
  if (!raw) return "";
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? String(n) : raw;
}

// Prefer the format (Manga/Manhwa/…) as a card subtitle, else the status.
function cardSubtitle(series: SeriesDto): string | undefined {
  const format = series.format?.trim();
  if (format && format.toLowerCase() !== "other") return format;
  const status = mapStatus(series.publication_status);
  return status !== "Unknown" ? status : undefined;
}

// ---------------------------------------------------------------------------
// listing parsers
// ---------------------------------------------------------------------------

export function toSearchResultItem(series: SeriesDto, apiUrl: string): SearchResultItem {
  return {
    mangaId: series.series_id,
    title: Application.decodeHTMLEntities(series.title),
    imageUrl: buildCoverUrl(apiUrl, series.cover_image_id),
    subtitle: cardSubtitle(series),
    contentRating: mapContentRating(series.content_rating),
  };
}

export function toSimpleItem(series: SeriesDto, apiUrl: string): DiscoverSectionItem {
  return {
    type: "simpleCarouselItem",
    mangaId: series.series_id,
    title: Application.decodeHTMLEntities(series.title),
    imageUrl: buildCoverUrl(apiUrl, series.cover_image_id),
    subtitle: cardSubtitle(series),
    contentRating: mapContentRating(series.content_rating),
  };
}

// A latest-feed series carries its newest book, so it renders as a proper
// chapter-update card (falling back to a simple card when the book is absent).
export function toLatestItem(series: SeriesDto, apiUrl: string): DiscoverSectionItem {
  const latest = series.latest_chapters?.[0];
  if (!latest?.book_id) return toSimpleItem(series, apiUrl);
  const number = formatChapterNumber(latest.chapter_no);
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: series.series_id,
    chapterId: latest.book_id,
    title: Application.decodeHTMLEntities(series.title),
    imageUrl: buildCoverUrl(apiUrl, series.cover_image_id),
    subtitle: number.length > 0 ? `Chapter ${number}` : undefined,
    publishDate: parseDate(latest.available_at ?? latest.created_at),
    contentRating: mapContentRating(series.content_rating),
  };
}

// ---------------------------------------------------------------------------
// manga details
// ---------------------------------------------------------------------------

// Pick the cover image id: prefer one in the translated language, else the
// first entry the detail carries.
function pickCoverImageId(detail: SeriesDetailDto): string | undefined {
  const covers = detail.series_covers ?? [];
  const preferred = covers.find(
    (cover) => cover.language && cover.language === detail.translated_language,
  );
  return (preferred ?? covers[0])?.image_id ?? undefined;
}

export function parseMangaDetails(
  detail: SeriesDetailDto,
  apiUrl: string,
  domain: string,
): SourceManga {
  // Genres and tags already arrive named on the detail response, so no
  // taxonomy lookup is needed; fold the format in as the first genre tag.
  const genreNames = [
    ...(detail.format && detail.format.toLowerCase() !== "other" ? [detail.format] : []),
    ...(detail.genres ?? [])
      .map((genre) => genre.genre_name?.trim())
      .filter((name): name is string => Boolean(name)),
  ];
  const tagNameList = (detail.tags ?? [])
    .map((tag) => tag.tag_name?.trim())
    .filter((name): name is string => Boolean(name));

  const toTags = (names: string[]): Tag[] =>
    [...new Set(names)].map((name) => ({
      id: name.toLowerCase().replace(/\s+/g, "-"),
      title: name,
    }));
  const genreTags = toTags(genreNames);
  const tagTags = toTags(tagNameList);

  const secondaryTitles = [
    ...new Set(
      (detail.series_alternate_titles ?? [])
        .map((alt) => (alt.title ?? "").trim())
        .filter((title) => title.length > 0 && title !== detail.title),
    ),
  ];

  const staff = detail.series_staff ?? [];
  const byRole = (role: string): string =>
    staff
      .filter((member) => (member.role ?? "").toLowerCase() === role)
      .map((member) => member.name?.trim())
      .filter((name): name is string => Boolean(name))
      .join(", ");
  const author = byRole("author");
  const artist = byRole("artist");

  // Paperback rejects an empty thumbnail URL outright (it crashes the whole
  // details page), so fall back to the site icon when a cover is missing.
  const thumbnailUrl = buildCoverUrl(apiUrl, pickCoverImageId(detail)) || `${domain}/favicon.ico`;

  return {
    mangaId: detail.series_id,
    mangaInfo: {
      primaryTitle: Application.decodeHTMLEntities(detail.title),
      secondaryTitles,
      thumbnailUrl,
      synopsis: Application.decodeHTMLEntities((detail.description ?? "").trim()),
      author: author.length > 0 ? author : undefined,
      artist: artist.length > 0 ? artist : undefined,
      status: mapStatus(detail.publication_status),
      contentRating: mapContentRating(detail.content_rating),
      tagGroups: [
        ...(genreTags.length > 0 ? [{ id: "genres", title: "Genres", tags: genreTags }] : []),
        ...(tagTags.length > 0 ? [{ id: "tags", title: "Tags", tags: tagTags }] : []),
      ],
      shareUrl: `${domain}/series/${detail.series_id}`,
    },
  };
}

// ---------------------------------------------------------------------------
// chapters
// ---------------------------------------------------------------------------

function buildChapterTitle(
  book: BookDto,
  format: string,
  showScanlator: boolean,
): string | undefined {
  // "number" leans on the app's chapter number and shows no title text.
  const base = format === "number" ? "" : Application.decodeHTMLEntities(book.title?.trim() ?? "");
  const group = showScanlator
    ? (book.groups ?? [])
        .map((g) => g.title?.trim())
        .filter((name): name is string => Boolean(name))[0]
    : undefined;
  const parts = [base, group].filter((part): part is string => Boolean(part && part.length > 0));
  return parts.length > 0 ? parts.join(" • ") : undefined;
}

export function parseChapterList(
  books: BookDto[],
  sourceManga: SourceManga,
  format: string,
  showScanlator: boolean,
): Chapter[] {
  return books
    .filter((book) => Boolean(book.book_id))
    .map((book) => {
      const chapNum = chapterNumberValue(book.chapter_no);
      const volume = book.volume_no ? chapterNumberValue(book.volume_no) : 0;
      return {
        chapterId: book.book_id,
        sourceManga,
        title: buildChapterTitle(book, format, showScanlator),
        chapNum,
        volume,
        langCode: "en",
        // `sort_no` is the server's canonical order; fall back to
        // volume-major / chapter-minor when it is absent.
        sortingIndex: typeof book.sort_no === "number" ? book.sort_no : volume * 100000 + chapNum,
        publishDate: parseDate(book.became_visible_at ?? book.available_at ?? book.created_at),
      } satisfies Chapter;
    });
}

// ---------------------------------------------------------------------------
// pages
// ---------------------------------------------------------------------------

export function parseReaderPages(reader: ReaderDto, bookId: string, dataSaver: boolean): string[] {
  const pages = [...(reader.manifest?.pages ?? [])]
    .sort((a, b) => a.page_no - b.page_no)
    .map((page) => buildPageUrl(reader.cache_url, bookId, page, reader.access_token, dataSaver))
    .filter((url) => url.length > 0);

  if (pages.length === 0) {
    throw new Error(`No pages returned for book ${bookId}.`);
  }
  return pages;
}
