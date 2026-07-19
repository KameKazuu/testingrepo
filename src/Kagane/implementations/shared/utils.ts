/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating } from "@paperback/types";

import { API_URL, CONTENT_RATING_VALUES, type KaganeContentRating } from "./models";

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

export function normalizeContentRating(value: unknown): KaganeContentRating {
  return typeof value === "string" && CONTENT_RATING_VALUES.includes(value as KaganeContentRating)
    ? (value as KaganeContentRating)
    : "safe";
}

export function getContentRatingValues(maxRating: KaganeContentRating): string[] {
  const index = CONTENT_RATING_VALUES.indexOf(maxRating);
  return CONTENT_RATING_VALUES.slice(0, Math.max(index, 0) + 1).map(titleCase);
}

export function getPaperbackContentRating(maxRating: KaganeContentRating): ContentRating {
  if (maxRating === "pornographic") return ContentRating.ADULT;
  if (maxRating === "erotica" || maxRating === "suggestive") return ContentRating.MATURE;
  return ContentRating.EVERYONE;
}

// A single title's own rating string ("Safe" / "Suggestive" / …) → Paperback.
export function mapItemContentRating(value?: string | null): ContentRating {
  switch ((value ?? "").toLowerCase()) {
    case "pornographic":
      return ContentRating.ADULT;
    case "erotica":
    case "suggestive":
      return ContentRating.MATURE;
    default:
      return ContentRating.EVERYONE;
  }
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
// details page. The API rates out of 100, so scale and clamp it.
export function ratingFraction(percent?: number | null): number {
  if (typeof percent !== "number" || percent <= 0) return 0;
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
  if (mode === "optional" || mode === "always" || mode === "vol_chapter") {
    return strippedTitle;
  }

  return strippedTitle;
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
