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
} from "@paperback/types";

import { getDomain } from "./forms/settings";
import {
  ADULT_TAG_IDS,
  CDN_URL,
  mapStatus,
  MATURE_TAG_IDS,
  TAGS_MAP,
  TYPE_NAMES,
  type ChapterDto,
  type PageListDto,
  type SeriesDto,
} from "./models";

// ---------------------------------------------------------------------------
// field helpers
// ---------------------------------------------------------------------------

/** Cover filenames are relative to the CDN `covers/` folder. */
export function buildCoverUrl(cover?: string | null): string {
  if (!cover) return "";
  // Some payloads already carry an absolute URL; leave those untouched.
  if (/^https?:\/\//i.test(cover)) return cover;
  return `${CDN_URL}/covers/${cover}`;
}

/** "75.00" / 75 → "75"; keeps a meaningful fraction like "10.5". */
export function formatChapterNumber(raw: number | string): string {
  const n = typeof raw === "number" ? raw : Number.parseFloat(raw);
  return Number.isFinite(n) ? String(n) : String(raw);
}

export function chapterNumberValue(raw: number | string): number {
  const n = typeof raw === "number" ? raw : Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

// The API serves timestamps as "yyyy-MM-dd HH:mm:ss" in UTC. Normalise to an
// ISO string so every engine parses it as UTC rather than local time.
export function parseDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function stripHtml(html?: string | null): string {
  if (!html) return "";
  return Application.decodeHTMLEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .trim(),
  );
}

// Rate a title from the site's own `content_rating` tier combined with its
// tags, keeping whichever is stricter. Tier 3 is mature, 4+ is adult; tiers
// 1–2 defer to the tag-derived rating.
export function deriveContentRating(
  series: Pick<SeriesDto, "tags" | "content_rating">,
): ContentRating {
  const tier = series.content_rating ?? 0;
  const tags = series.tags;
  if (tier >= 4 || tags?.some((id) => ADULT_TAG_IDS.has(id))) return ContentRating.ADULT;
  if (tier === 3 || tags?.some((id) => MATURE_TAG_IDS.has(id))) return ContentRating.MATURE;
  return ContentRating.EVERYONE;
}

function tagNames(tags?: number[] | null): string[] {
  return (tags ?? []).map((id) => TAGS_MAP[id]).filter((name): name is string => Boolean(name));
}

// Prefer the series type (Manga/Manhwa/…) as the card subtitle; fall back to
// the publication status when the type is missing.
function cardSubtitle(series: SeriesDto): string | undefined {
  const type = series.type != null ? TYPE_NAMES[series.type] : undefined;
  if (type) return type;
  const status = mapStatus(series.status);
  return status !== "Unknown" ? status : undefined;
}

// ---------------------------------------------------------------------------
// listing parsers
// ---------------------------------------------------------------------------

export function toSearchResultItem(series: SeriesDto): SearchResultItem {
  return {
    mangaId: String(series.id),
    title: Application.decodeHTMLEntities(series.title),
    imageUrl: buildCoverUrl(series.cover),
    subtitle: cardSubtitle(series),
    contentRating: deriveContentRating(series),
  };
}

export function toFeaturedItem(series: SeriesDto): DiscoverSectionItem {
  return {
    type: "featuredCarouselItem",
    mangaId: String(series.id),
    title: Application.decodeHTMLEntities(series.title),
    imageUrl: buildCoverUrl(series.cover),
    supertitle: tagNames(series.tags).slice(0, 3).join(" • ") || cardSubtitle(series),
    contentRating: deriveContentRating(series),
  };
}

export function toSimpleItem(series: SeriesDto): DiscoverSectionItem {
  return {
    type: "simpleCarouselItem",
    mangaId: String(series.id),
    title: Application.decodeHTMLEntities(series.title),
    imageUrl: buildCoverUrl(series.cover),
    subtitle: cardSubtitle(series),
    contentRating: deriveContentRating(series),
  };
}

// A latest-feed series carries its newest chapter, so it can render as a proper
// chapter-update card (falling back to a simple card when the chapter is absent).
export function toLatestItem(series: SeriesDto): DiscoverSectionItem {
  const latest = series.chapters?.[0];
  if (!latest?.id) return toSimpleItem(series);
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: String(series.id),
    chapterId: String(latest.id),
    title: Application.decodeHTMLEntities(series.title),
    imageUrl: buildCoverUrl(series.cover),
    subtitle: latest.number != null ? `Chapter ${formatChapterNumber(latest.number)}` : undefined,
    publishDate: parseDate(latest.created_at),
    contentRating: deriveContentRating(series),
  };
}

// ---------------------------------------------------------------------------
// manga details
// ---------------------------------------------------------------------------

export function parseMangaDetails(series: SeriesDto): SourceManga {
  // Merge the type name, numeric tags and free-text themes into one tag set.
  const typeName = series.type != null ? TYPE_NAMES[series.type] : undefined;
  const names = [
    ...(typeName ? [typeName] : []),
    ...tagNames(series.tags),
    ...(series.themes ?? []).map((theme) => theme.trim()).filter((theme) => theme.length > 0),
  ];
  const uniqueNames = [...new Set(names)];
  const tags: Tag[] = uniqueNames.map((name) => ({
    id: name.toLowerCase().replace(/\s+/g, "-"),
    title: name,
  }));

  const secondaryTitles = [
    ...new Set(
      (series.alternative_titles ?? [])
        .map((alt) => (alt.title ?? "").trim())
        .filter((title) => title.length > 0),
    ),
  ];

  const author = (series.author ?? []).filter(Boolean).join(", ");
  const artist = (series.artist ?? []).filter(Boolean).join(", ");

  return {
    mangaId: String(series.id),
    mangaInfo: {
      primaryTitle: Application.decodeHTMLEntities(series.title),
      secondaryTitles,
      thumbnailUrl: buildCoverUrl(series.cover),
      synopsis: stripHtml(series.summary),
      author: author.length > 0 ? author : undefined,
      artist: artist.length > 0 ? artist : undefined,
      status: mapStatus(series.status),
      contentRating: deriveContentRating(series),
      tagGroups: tags.length > 0 ? [{ id: "tags", title: "Tags", tags }] : [],
      shareUrl: `${getDomain()}/series/${series.id}`,
    },
  };
}

// ---------------------------------------------------------------------------
// chapters
// ---------------------------------------------------------------------------

// Compose a readable chapter title from the chapter's own title and the
// scanlation group (Paperback has no dedicated scanlator field, so the group is
// folded into the title — it also disambiguates duplicate numbers from
// different groups).
function buildChapterTitle(chapter: ChapterDto): string | undefined {
  const bits: string[] = [];
  const title = chapter.title?.trim();
  const group = chapter.group?.title?.trim();
  if (title) bits.push(Application.decodeHTMLEntities(title));
  if (group) bits.push(group);
  return bits.length > 0 ? bits.join(" • ") : undefined;
}

export function parseChapterList(chapters: ChapterDto[], sourceManga: SourceManga): Chapter[] {
  // Newest first from the API; index gives a stable, descending sort key.
  return chapters.map((chapter, index) => ({
    chapterId: String(chapter.id),
    sourceManga,
    title: buildChapterTitle(chapter),
    chapNum: chapterNumberValue(chapter.number),
    volume: 0,
    langCode: "en",
    sortingIndex: chapters.length - index,
    publishDate: parseDate(chapter.created_at),
    additionalInfo: {
      seriesId: sourceManga.mangaId,
      groupId: String(chapter.group_id ?? 0),
    },
  }));
}

// ---------------------------------------------------------------------------
// pages
// ---------------------------------------------------------------------------

export function parseChapterDetails(data: PageListDto, chapter: Chapter): ChapterDetails {
  const chapterData = data.chapter;
  const chapterId = chapterData?.id ?? Number(chapter.chapterId);
  const pages = [...(chapterData?.pages ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((page) => `${CDN_URL}/pages/${chapterId}/${page.path}`)
    .filter((url) => url.length > 0);

  if (pages.length === 0) {
    throw new Error(`No pages returned for chapter ${chapter.chapterId}.`);
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
}
