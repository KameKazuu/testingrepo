/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating, URL } from "@paperback/types";

import { API_URL } from "./models";

// The reader fetches a page from the cache CDN as
//   {cache_url}/api/v2/books/page/{chapterId}/{file}?token={token}
// and, in data-saver mode, inserts a `datasaver` path segment after `page`
// (the quality is selected by the path, not a query — the challenge request is
// what carries is_datasaver).
export function buildPageUrl(
  cacheUrl: string,
  chapterId: string,
  fileName: string,
  token: string,
  dataSaver: boolean,
): string {
  const url = new URL(cacheUrl)
    .addPathComponent("api")
    .addPathComponent("v2")
    .addPathComponent("books")
    .addPathComponent("page");
  if (dataSaver) {
    url.addPathComponent("datasaver");
  }
  return url
    .addPathComponent(chapterId)
    .addPathComponent(fileName)
    .setQueryItem("token", token)
    .toString();
}

export function applyMixins(derivedCtor: Constructor, constructors: Constructor[]) {
  for (const baseCtor of constructors) {
    for (const name of Object.getOwnPropertyNames(baseCtor.prototype)) {
      if (name !== "constructor") {
        Object.defineProperty(
          derivedCtor.prototype,
          name,
          Object.getOwnPropertyDescriptor(baseCtor.prototype, name) ?? Object.create(null),
        );
      }
    }
  }
}

type Constructor = new (...args: never[]) => unknown;

export function buildImageUrl(imageId?: string | null): string {
  return imageId ? `${API_URL}/api/v2/image/${imageId}` : "";
}

export function titleCase(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

// A single title's own rating string ("Safe" / "Suggestive" / …) → Paperback.
// Anything missing or unrecognized is treated as MATURE — the safer fallback
// for a catalog like this.
export function mapItemContentRating(value?: string | null): ContentRating {
  switch ((value ?? "").toLowerCase()) {
    case "safe":
      return ContentRating.EVERYONE;
    case "pornographic":
      return ContentRating.ADULT;
    default:
      return ContentRating.MATURE;
  }
}

// Prefer the average rating, falling back to the bayesian one — a plain ??
// would keep an average of 0 and never fall back.
export function pickRating(average?: number | null, bayesian?: number | null): number | undefined {
  if (typeof average === "number" && average > 0) return average;
  if (typeof bayesian === "number" && bayesian > 0) return bayesian;
  return undefined;
}

// Resolve a series' genre UUIDs to display names via the metadata map.
export function resolveGenreNames(
  genreIds: string[] | undefined,
  genres: Record<string, string>,
  max = 3,
): string[] {
  return (genreIds ?? [])
    .map((id) => genres[id])
    .filter((name): name is string => Boolean(name))
    .slice(0, max);
}

// Compact view-count label: 12345 → "12.3K", 2100000 → "2.1M".
export function formatViews(views?: number | null): string | undefined {
  if (typeof views !== "number" || views <= 0) return undefined;
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`;
  return String(views);
}

// The API rates titles out of 100. Discover cards show a starred /10 score
// ("★ 8.6"); the details page shows a native percentage star via
// MangaInfo.rating.
export function starRating(percent?: number | null): string | undefined {
  if (typeof percent !== "number" || percent <= 0) return undefined;
  return `★ ${(percent / 10).toFixed(1)}`;
}

// MangaInfo.rating is a 0–1 value the app renders as a percentage star on the
// details page. The API rates out of 100, so scale and clamp it; a missing
// rating is omitted rather than shown as 0%.
export function ratingFraction(percent?: number | null): number | undefined {
  if (typeof percent !== "number" || percent <= 0) return undefined;
  return Math.min(1, Math.max(0, percent / 100));
}

export function parseKaganeDate(value?: string | null): Date | undefined {
  if (!value) return undefined;

  // Timestamps come either ISO with an offset ("…+00:00") or as a bare
  // "yyyy-MM-dd HH:mm:ss" in UTC. Only append Z when no zone is present —
  // appending it to an offset string yields an invalid date.
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
  const parsed = new Date(hasZone ? iso : `${iso}Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function mapPublicationStatus(status: string): string {
  switch (status.toUpperCase()) {
    case "ONGOING":
      return "Ongoing";
    case "COMPLETED":
      return "Completed";
    case "HIATUS":
      return "Hiatus";
    case "ABANDONED":
      return "Cancelled";
    default:
      return "Unknown";
  }
}

export function parseChapterNumber(value?: string | null): number | undefined {
  if (!value) return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function joinUnique(values: string[]): string | undefined {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return unique.length > 0 ? unique.join(", ") : undefined;
}

export function buildChapterTitle(
  title: string,
  chapterNo?: string | null,
  volumeNo?: string | null,
  mode = "optional",
  chapterNumberCandidates: string[] = [],
): string {
  const displayChapterNo = normalizeNumberLabel(chapterNo);
  const displayVolumeNo = normalizeNumberLabel(volumeNo);
  const volumeStrippedTitle = stripDuplicateVolumePrefix(title.trim(), displayVolumeNo);
  const strippedTitle = stripDuplicateChapterPrefix(volumeStrippedTitle, [
    displayChapterNo,
    ...chapterNumberCandidates,
  ]);

  const chapterLabel = displayChapterNo ? `Ch.${displayChapterNo}` : undefined;
  const volumeLabel = displayVolumeNo ? `Vol.${displayVolumeNo}` : undefined;

  if (mode === "always") {
    // "Ch.X Title" — prepend the chapter number to whatever title remains.
    return joinParts([chapterLabel, strippedTitle]) || strippedTitle;
  }

  if (mode === "vol_chapter") {
    // "Vol.X Ch.Y Title" — prepend both the volume and chapter numbers.
    return joinParts([volumeLabel, chapterLabel, strippedTitle]) || strippedTitle;
  }

  // optional: the chapter's own title, falling back to the chapter (or volume)
  // label when it has none.
  return strippedTitle || chapterLabel || volumeLabel || "";
}

function joinParts(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

function normalizeNumberLabel(value?: string | null): string | undefined {
  const label = value?.trim();
  if (!label) {
    return undefined;
  }

  return label;
}

function stripDuplicateChapterPrefix(
  title: string,
  chapterNumbers: Array<string | undefined>,
): string {
  const candidates = [
    ...new Set(
      chapterNumbers.map(normalizeNumberLabel).filter((value): value is string => Boolean(value)),
    ),
  ];

  for (const chapterNo of candidates) {
    const escapedChapterNo = chapterNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const duplicatePrefix = new RegExp(
      `^(?:chapter|episode|ch\\.?|#)\\s*${escapedChapterNo}(?:\\s*(?:[-:\\u2013\\u2014]|\\.(?!\\d))\\s*|\\s+|$)`,
      "i",
    );
    const stripped = title.replace(duplicatePrefix, "").trim();
    if (stripped !== title) return stripped;
  }

  return title.replace(genericChapterPrefixRegex(), "").trim();
}

function genericChapterPrefixRegex(): RegExp {
  return /^(?:chapter|episode|ch\.?|#)\s*\d+(?:\.\d+)?(?:\s*(?:[-:\u2013\u2014]|\.(?!\d))\s*|\s+|$)/i;
}

function stripDuplicateVolumePrefix(title: string, volumeNo?: string): string {
  const candidate = normalizeNumberLabel(volumeNo);
  if (!candidate) return title;

  const escapedVolumeNo = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const duplicatePrefix = new RegExp(
    `^(?:volume|vol\\.?)\\s*${escapedVolumeNo}(?:\\s*(?:[-:\\u2013\\u2014]|\\.(?!\\d))\\s*|\\s+|$)`,
    "i",
  );

  return title.replace(duplicatePrefix, "").trim();
}
