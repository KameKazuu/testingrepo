/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";

import { DOMAIN } from "./models";
import type { CatalogItem, ChapterEntry, ReaderChapter, SeriesProps } from "./models";

// ----------------------------------------------------------------
// Payload extraction
//
// Pages are server-rendered with their data embedded as a streamed payload:
// script tags push string fragments (`self.__next_f.push([1,"…"])`) that
// concatenate into one text stream containing the JSON props we need.
// ----------------------------------------------------------------

const FLIGHT_CHUNK_REGEX = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;

/**
 * Concatenate a page's embedded payload fragments into one searchable string.
 * Each fragment is a JS string literal, so JSON.parse unescapes it. A response
 * without fragments (a raw payload response) is already the stream itself.
 */
export function decodeFlightPayload(html: string): string {
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  FLIGHT_CHUNK_REGEX.lastIndex = 0;
  while ((match = FLIGHT_CHUNK_REGEX.exec(html)) !== null) {
    try {
      parts.push(JSON.parse(`"${match[1]}"`) as string);
    } catch {
      // A fragment that fails to unescape carries no JSON of ours; skip it.
    }
  }
  return parts.length > 0 ? parts.join("") : html;
}

/**
 * Extract the balanced JSON object/array beginning at `start` — a scanner that
 * tracks string state so braces inside values don't break the depth count.
 */
function extractBalancedJson(text: string, start: number): string | undefined {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : undefined;
  if (!close) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

/** Find `anchor` in the stream and parse the JSON value that starts there. */
function parseJsonAt<T>(payload: string, anchor: string, offset = 0): T | undefined {
  const index = payload.indexOf(anchor);
  if (index < 0) return undefined;
  const blob = extractBalancedJson(payload, index + offset);
  if (!blob) return undefined;
  try {
    return JSON.parse(blob) as T;
  } catch {
    return undefined;
  }
}

// ----------------------------------------------------------------
// Catalog
// ----------------------------------------------------------------

/** Series cards from a catalog page (`"initialItems":[…]`). */
export function parseCatalogItems(html: string): CatalogItem[] {
  const payload = decodeFlightPayload(html);
  const items = parseJsonAt<CatalogItem[]>(payload, '"initialItems":[', '"initialItems":'.length);
  return (items ?? []).filter((item) => Boolean(item.slug) && Boolean(item.title));
}

// Listing cards carry no age rating; genres are the only content signal.
export function contentRatingForGenres(genres: string[] | undefined): ContentRating {
  const lower = (genres ?? []).map((genre) => genre.toLowerCase());
  if (["hentai", "adult", "smut", "lolicon", "shotacon"].some((genre) => lower.includes(genre))) {
    return ContentRating.ADULT;
  }
  if (["ecchi", "mature", "harem"].some((genre) => lower.includes(genre))) {
    return ContentRating.MATURE;
  }
  return ContentRating.EVERYONE;
}

export function toSearchResultItem(item: CatalogItem): SearchResultItem {
  const chapterCount = item._count?.chapters ?? 0;
  return {
    mangaId: item.slug,
    title: item.title,
    imageUrl: item.poster,
    contentRating: contentRatingForGenres(item.genres),
    subtitle: chapterCount > 0 ? `${chapterCount} chapters` : (item.type ?? ""),
  };
}

// ----------------------------------------------------------------
// Discover cards
// ----------------------------------------------------------------

/** "★ 8.6" when the catalog card carries a score, else nothing. */
function starRating(rating?: number): string | undefined {
  if (typeof rating !== "number" || rating <= 0) return undefined;
  return `★ ${rating.toFixed(1)}`;
}

export function toFeaturedItem(item: CatalogItem): DiscoverSectionItem {
  const chapterCount = item._count?.chapters ?? 0;
  const parts = [
    chapterCount > 0 ? `Ch. ${chapterCount}` : undefined,
    starRating(item.rating),
  ].filter((part): part is string => Boolean(part));

  return {
    type: "featuredCarouselItem",
    mangaId: item.slug,
    title: item.title,
    imageUrl: item.poster,
    supertitle: parts.length > 0 ? parts.join(" | ") : (item.type ?? ""),
    summary: (item.genres ?? []).slice(0, 4).join(" · "),
    contentRating: contentRatingForGenres(item.genres),
    metadata: undefined,
  };
}

export function toProminentItem(item: CatalogItem): DiscoverSectionItem {
  return {
    type: "prominentCarouselItem",
    mangaId: item.slug,
    title: item.title,
    imageUrl: item.poster,
    subtitle: starRating(item.rating) ?? item.type ?? "",
    contentRating: contentRatingForGenres(item.genres),
    metadata: undefined,
  };
}

export function toSimpleItem(item: CatalogItem): DiscoverSectionItem {
  const chapterCount = item._count?.chapters ?? 0;
  return {
    type: "simpleCarouselItem",
    mangaId: item.slug,
    title: item.title,
    imageUrl: item.poster,
    subtitle: chapterCount > 0 ? `Ch. ${chapterCount}` : (item.type ?? ""),
    contentRating: contentRatingForGenres(item.genres),
    metadata: undefined,
  };
}

// ----------------------------------------------------------------
// Series details & chapters
// ----------------------------------------------------------------

/** The series client-component props (`{"initialTab":…}`) from a series page. */
export function parseSeriesProps(html: string, slug: string): SeriesProps {
  const payload = decodeFlightPayload(html);
  const props = parseJsonAt<SeriesProps>(payload, '{"initialTab"');
  if (!props || !props.title) {
    throw new Error(`No series payload found for ${slug} — the page layout may have changed.`);
  }
  return props;
}

/** Cover from the page's og:image meta — the payload itself has no poster. */
export function parseCoverUrl(html: string): string {
  const match =
    html.match(/property="og:image"\s+content="([^"]+)"/) ??
    html.match(/"og:image","content":"([^"]+)"/);
  return match?.[1] ?? "";
}

function contentRatingForSeries(props: SeriesProps): ContentRating {
  const age = (props.ageRating ?? "").trim();
  if (age === "18+" || age === "21+") return ContentRating.ADULT;
  if (age === "15+" || age === "16+") return ContentRating.MATURE;
  const fromGenres = contentRatingForGenres(props.genres);
  // "For all"/"12+" trusts the label unless an adult genre says otherwise.
  return fromGenres === ContentRating.ADULT ? fromGenres : ContentRating.EVERYONE;
}

function toTagSection(id: string, title: string, names: string[]): TagSection | undefined {
  if (names.length === 0) return undefined;
  const tags: Tag[] = names.map((name) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title: name,
  }));
  return { id, title, tags };
}

export function parseMangaDetails(html: string, mangaId: string): SourceManga {
  const props = parseSeriesProps(html, mangaId);

  const tagGroups = [
    toTagSection("genres", "Genres", props.genres ?? []),
    toTagSection("tags", "Tags", props.tags ?? []),
  ].filter((section): section is TagSection => section !== undefined);

  return {
    mangaId,
    mangaInfo: {
      thumbnailUrl: parseCoverUrl(html),
      synopsis: props.description ?? "",
      primaryTitle: props.title,
      secondaryTitles: props.altNames ?? [],
      contentRating: contentRatingForSeries(props),
      status: props.status ?? "Unknown",
      artist: props.artist ?? "",
      author: props.author ?? "",
      tagGroups,
      shareUrl: `${DOMAIN}/manga/${mangaId}`,
    },
  };
}

/** "$D2026-07-14T02:23:00.772Z" → Date (the serializer prefixes dates with $D). */
function parsePayloadDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value.replace(/^\$D/, ""));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * The reader addresses chapters by number alone and serves one default upload
 * per number, so the list is deduped to one entry per number (first listed
 * wins — the site's own ordering) with the team name as the version label.
 */
export function parseChapters(html: string, sourceManga: SourceManga): Chapter[] {
  const props = parseSeriesProps(html, sourceManga.mangaId);
  const entries = (props.chapters ?? []).filter((entry) => entry.isLocked !== true);

  const seen = new Set<number>();
  const chapters: Chapter[] = [];
  for (const entry of entries) {
    if (typeof entry.number !== "number" || seen.has(entry.number)) continue;
    seen.add(entry.number);
    chapters.push(toChapter(entry, sourceManga));
  }
  return chapters;
}

function toChapter(entry: ChapterEntry, sourceManga: SourceManga): Chapter {
  const title = entry.title?.trim() ?? "";
  const version = entry.team?.name ?? entry.translator ?? undefined;
  const volume = typeof entry.volume === "number" && entry.volume > 1 ? entry.volume : undefined;

  return {
    chapterId: String(entry.number),
    sourceManga,
    langCode: "en",
    chapNum: entry.number,
    title,
    volume,
    version,
    sortingIndex: entry.number,
    publishDate: parsePayloadDate(entry.createdAt),
  };
}

// ----------------------------------------------------------------
// Reader
// ----------------------------------------------------------------

export function parseChapterDetails(html: string, chapter: Chapter): ChapterDetails {
  const payload = decodeFlightPayload(html);
  const reader = parseJsonAt<ReaderChapter>(payload, '"chapter":{"id":', '"chapter":'.length);

  const pages = reader?.pages && reader.pages.length > 0 ? reader.pages : (reader?.pagesAlt ?? []);
  if (pages.length === 0) {
    throw new Error(
      `No pages returned for chapter ${chapter.chapterId} of ${chapter.sourceManga.mangaId}.`,
    );
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
}
