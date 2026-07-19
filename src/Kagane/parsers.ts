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

export function parseMangaDetails(
  series: SeriesDto,
  apiUrl: string,
  domain: string,
  genreNames: Map<string, string>,
): SourceManga {
  // Resolve genre UUIDs to names via the taxonomy map; fold in the format.
  const names = [
    ...(series.format && series.format.toLowerCase() !== "other" ? [series.format] : []),
    ...(series.genres ?? [])
      .map((id) => genreNames.get(id))
      .filter((name): name is string => Boolean(name)),
  ];
  const uniqueNames = [...new Set(names)];
  const tags: Tag[] = uniqueNames.map((name) => ({
    id: name.toLowerCase().replace(/\s+/g, "-"),
    title: name,
  }));

  const secondaryTitles = [
    ...new Set(
      (series.alternate_titles ?? [])
        .map((title) => title.trim())
        .filter((title) => title.length > 0),
    ),
  ];

  return {
    mangaId: series.series_id,
    mangaInfo: {
      primaryTitle: Application.decodeHTMLEntities(series.title),
      secondaryTitles,
      thumbnailUrl: buildCoverUrl(apiUrl, series.cover_image_id),
      synopsis: Application.decodeHTMLEntities((series.description ?? "").trim()),
      status: mapStatus(series.publication_status),
      contentRating: mapContentRating(series.content_rating),
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
      shareUrl: `${domain}/series/${series.series_id}`,
    },
  };
}

// ---------------------------------------------------------------------------
// chapters
// ---------------------------------------------------------------------------

function buildChapterTitle(book: BookDto): string | undefined {
  const title = book.title?.trim();
  return title ? Application.decodeHTMLEntities(title) : undefined;
}

export function parseChapterList(books: BookDto[], sourceManga: SourceManga): Chapter[] {
  return books
    .filter((book) => Boolean(book.book_id))
    .map((book) => {
      const chapNum = chapterNumberValue(book.chapter_no);
      const volume = book.volume_no ? chapterNumberValue(book.volume_no) : 0;
      return {
        chapterId: book.book_id,
        sourceManga,
        title: buildChapterTitle(book),
        chapNum,
        volume,
        langCode: "en",
        // `sort_no` is the server's canonical order; fall back to
        // volume-major / chapter-minor when it is absent.
        sortingIndex: typeof book.sort_no === "number" ? book.sort_no : volume * 100000 + chapNum,
        publishDate: parseDate(book.available_at ?? book.created_at),
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
