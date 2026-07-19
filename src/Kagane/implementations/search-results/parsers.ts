/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SourceDto } from "../shared/models";

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
