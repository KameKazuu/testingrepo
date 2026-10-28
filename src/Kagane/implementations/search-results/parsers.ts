/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SearchFilterValue } from "@paperback/types/lib/compat/0.8";

import type { KaganeSearchMetadata, SourceDto } from "../shared/models";

type MultiselectValue = Record<string, "included" | "excluded">;

export function readDropdownFilter(
  filters: SearchFilterValue[],
  filterId: string,
  fallback: string,
): string {
  const entry = filters.find((filter) => filter.id === filterId);
  return typeof entry?.value === "string" && entry.value ? entry.value : fallback;
}

export function readInputFilter(filters: SearchFilterValue[], filterId: string): string {
  const entry = filters.find((filter) => filter.id === filterId);
  return typeof entry?.value === "string" ? entry.value.trim() : "";
}

export function readMultiselectFilter(
  filters: SearchFilterValue[],
  filterId: string,
  state: "included" | "excluded" = "included",
): string[] {
  const entry = filters.find((filter) => filter.id === filterId);
  if (!entry || typeof entry.value === "string") return [];

  return Object.entries(entry.value as MultiselectValue)
    .filter(([, value]) => value === state)
    .map(([id]) => id);
}

export function readMultiselectRecord(
  filters: SearchFilterValue[],
  filterId: string,
): MultiselectValue | undefined {
  const entry = filters.find((filter) => filter.id === filterId);
  return entry && typeof entry.value === "object" && entry.value
    ? (entry.value as MultiselectValue)
    : undefined;
}

// A comma-separated tag list where a leading "-" excludes: "romance, -gore".
export function parseTagInput(input: string): { included: string[]; excluded: string[] } {
  const included: string[] = [];
  const excluded: string[] = [];

  for (const rawEntry of input.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const shouldExclude = entry.startsWith("-");
    const tagName = shouldExclude ? entry.slice(1).trim() : entry;
    if (!tagName) continue;

    (shouldExclude ? excluded : included).push(tagName);
  }

  return { included, excluded };
}

export function getVisibleSources(sources: SourceDto[], displayMode: string): SourceDto[] {
  if (displayMode === "official") {
    return sources.filter((source) => source.source_type.toLowerCase() === "official");
  }
  if (displayMode === "scanlations") {
    return sources.filter((source) => source.source_type.toLowerCase() !== "official");
  }
  return sources;
}

export function normalizeMetadata(
  raw: SearchFilterValue[] | KaganeSearchMetadata | undefined,
): KaganeSearchMetadata {
  if (Array.isArray(raw)) {
    const filters = raw;
    const range = readDropdownFilter(filters, "range", "none");
    return {
      range: range !== "none" ? range : undefined,
      formats: readMultiselectIncluded(filters, "formats"),
      statuses: readMultiselectIncluded(filters, "statuses"),
      publicationStatuses: readMultiselectIncluded(filters, "publication_statuses"),
      ratings: readMultiselectIncluded(filters, "ratings"),
      disturbing: readDropdownFilter(filters, "disturbing", "default"),
      creator: readInputFilter(filters, "creator"),
      group: readInputFilter(filters, "group"),
      chaptersFrom: readInputFilter(filters, "chapters_from"),
      chaptersTo: readInputFilter(filters, "chapters_to"),
      languages: readMultiselectIncluded(filters, "languages"),
      sourceTypes: readMultiselectIncluded(filters, "source_types"),
      sources: readMultiselectIncluded(filters, "sources"),
      yearFrom: readInputFilter(filters, "year_from"),
      yearTo: readInputFilter(filters, "year_to"),
      genres: readMultiselectRecord(filters, "genres"),
      genresMatchAll: readDropdownFilter(filters, "genres_match_all", "true") === "true",
      tags: readMultiselectRecord(filters, "tags"),
      tagsMatchAll: readDropdownFilter(filters, "tags_match_all", "true") === "true",
      typedTags: readInputFilter(filters, "tags_text"),
    };
  }
  return raw && typeof raw === "object" ? raw : {};
}

function readMultiselectIncluded(filters: SearchFilterValue[], filterId: string): string[] {
  return Object.entries(readMultiselectRecord(filters, filterId) ?? {})
    .filter(([, state]) => state === "included")
    .map(([id]) => id);
}

export const parseRange = (
  lower: string | undefined,
  upper: string | undefined,
  label: string,
): { min?: number; max?: number } | undefined => {
  const bounds: { min?: number; max?: number } = {};
  for (const [key, raw] of [
    ["min", lower],
    ["max", upper],
  ] as const) {
    const text = raw?.trim();
    if (!text) continue;
    const value = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value > 2147483647)
      throw new Error(`${label}: enter whole numbers from 0 to 2147483647.`);
    bounds[key] = value;
  }
  if (bounds.min !== undefined && bounds.max !== undefined && bounds.min > bounds.max)
    throw new Error(`${label}: the minimum must not exceed the maximum.`);
  return Object.keys(bounds).length ? bounds : undefined;
};
