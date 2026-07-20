/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SearchFilterValue } from "@paperback/types/lib/compat/0.8";

import type { SourceDto } from "../shared/models";

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
  return displayMode === "official"
    ? sources.filter((source) => source.source_type.toLowerCase() === "official")
    : sources;
}
