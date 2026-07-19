/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SearchFilter, SearchFilterValue } from "@paperback/types/lib/compat/0.8";

import {
  FORMAT_OPTIONS,
  PUBLICATION_STATUS_OPTIONS,
  type KaganeMetadata,
  type SourceDto,
} from "../shared/models";

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

export function findIdsByName(names: string[], values: Record<string, string>): string[] {
  return names
    .map((name) => {
      const lowerName = name.toLowerCase();
      return Object.entries(values).find(([, value]) => value.toLowerCase() === lowerName)?.[0];
    })
    .filter((value): value is string => Boolean(value));
}

export function parseTagInput(input: string): { included: string[]; excluded: string[] } {
  const included: string[] = [];
  const excluded: string[] = [];

  for (const rawEntry of input.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const shouldExclude = entry.startsWith("-");
    const tagName = shouldExclude ? entry.slice(1).trim() : entry;
    if (!tagName) continue;
  }

  return { included, excluded };
}

export function buildSearchFilters(metadata: KaganeMetadata, displayMode: string): SearchFilter[] {
  const sources = getVisibleSources(metadata.sources, displayMode);

  return [
    {
      type: "multiselect",
      id: "formats",
      title: "Format",
      options: FORMAT_OPTIONS.map((format) => ({ id: format, value: format })),
      value: {},
      allowExclusion: false,
      allowEmptySelection: true,
      maximum: undefined,
    },
    {
      type: "multiselect",
      id: "statuses",
      title: "Status",
      options: PUBLICATION_STATUS_OPTIONS,
      value: {},
      allowExclusion: false,
      allowEmptySelection: true,
      maximum: undefined,
    },
    {
      type: "dropdown",
      id: "genres_match_all",
      title: "Genre Matching",
      options: [
        { id: "true", value: "Match All Selected Genres" },
        { id: "false", value: "Match Any Selected Genre" },
      ],
      value: "true",
    },
    {
      type: "multiselect",
      id: "genres",
      title: "Genres",
      options: Object.entries(metadata.genres)
        .sort(([, left], [, right]) => left.localeCompare(right))
        .map(([id, value]) => ({ id, value })),
      value: {},
      allowExclusion: true,
      allowEmptySelection: true,
      maximum: undefined,
    },
    {
      type: "dropdown",
      id: "tags_match_all",
      title: "Tag Matching",
      options: [
        { id: "true", value: "Match All Entered Tags" },
        { id: "false", value: "Match Any Entered Tag" },
      ],
      value: "true",
    },
    {
      type: "multiselect",
      id: "sources",
      title: "Sources",
      options: sources
        .sort((left, right) => left.title.localeCompare(right.title))
        .map((source) => ({ id: source.source_id, value: source.title })),
      value: {},
      allowExclusion: false,
      allowEmptySelection: true,
      maximum: undefined,
    },
  ];
}

export function getVisibleSources(sources: SourceDto[], displayMode: string): SourceDto[] {
  return displayMode === "official"
    ? sources.filter((source) => source.source_type.toLowerCase() === "official")
    : sources;
}
