/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating, type SourceManga, type Tag } from "@paperback/types";

import { DOMAIN, type Series } from "./models";

export function seriesTitle(series: Series): string {
  const titles = series.titles ?? [];
  const primary = titles.find((entry) => entry.is_primary === true && entry.title);
  const english = titles.find((entry) => entry.language === "en" && entry.title);
  const first = titles.find((entry) => entry.title);

  return Application.decodeHTMLEntities(
    primary?.title ?? english?.title ?? first?.title ?? `Series ${series.id}`,
  );
}

export function seriesThumbnail(series: Series): string {
  const cover = series.cover;
  return cover?.x350 ?? cover?.x250 ?? cover?.raw ?? cover?.x150 ?? "";
}

export function seriesSubtitle(series: Series): string | undefined {
  const parts = [series.type, series.status]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.charAt(0).toUpperCase() + value.slice(1));

  return parts.length > 0 ? parts.join(" • ") : undefined;
}

export function contentRatingFor(series: Series): ContentRating {
  switch (series.content_rating) {
    case "pornographic":
      return ContentRating.ADULT;
    case "erotica":
    case "suggestive":
      return ContentRating.MATURE;
    default:
      return ContentRating.EVERYONE;
  }
}

function mapStatus(status?: string | null): string {
  switch (status) {
    case "releasing":
      return "Ongoing";
    case "completed":
      return "Completed";
    case "hiatus":
      return "Hiatus";
    case "cancelled":
      return "Cancelled";
    case "upcoming":
      return "Upcoming";
    default:
      return "Unknown";
  }
}

export function parseSourceManga(series: Series): SourceManga {
  const titles = series.titles ?? [];
  const primaryTitle = seriesTitle(series);
  const seen = new Set([primaryTitle.toLowerCase()]);
  const secondaryTitles: string[] = [];

  for (const entry of titles) {
    const title = entry.title ? Application.decodeHTMLEntities(entry.title) : "";
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    secondaryTitles.push(title);
  }

  const tags: Tag[] = (series.tags ?? [])
    .map((tag) => tag.name)
    .filter((name): name is string => Boolean(name))
    .map((name) => ({ id: name.toLowerCase().replace(/\s+/g, "-"), title: name }));

  return {
    mangaId: String(series.id),
    mangaInfo: {
      primaryTitle,
      secondaryTitles,
      thumbnailUrl: seriesThumbnail(series),
      synopsis: series.description ? Application.decodeHTMLEntities(series.description) : "",
      author: (series.authors ?? []).filter(Boolean).join(", ") || undefined,
      artist: (series.artists ?? []).filter(Boolean).join(", ") || undefined,
      status: mapStatus(series.status),
      rating:
        series.rating == null || !Number.isFinite(series.rating)
          ? undefined
          : Math.min(1, Math.max(0, series.rating / 10)),
      contentRating: contentRatingFor(series),
      contentType: series.type === "novel" ? "novel" : "comic",
      tagGroups: tags.length > 0 ? [{ id: "tags", title: "Tags", tags }] : [],
      shareUrl: `${DOMAIN}/series/${series.id}`,
    },
  };
}
