/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating, type SourceManga, type Tag } from "@paperback/types";

import { DOMAIN, type Series, type SeriesTitle, TITLE_PREFERENCE_KEY } from "./models";

export type TitlePreference = "english" | "romanized" | "native";

export const TITLE_PREFERENCES: { id: TitlePreference; title: string }[] = [
  { id: "english", title: "English" },
  { id: "romanized", title: "Romanized" },
  { id: "native", title: "Original Language" },
];

export function getTitlePreference(): TitlePreference {
  const stored = Application.getState(TITLE_PREFERENCE_KEY);
  return stored === "romanized" || stored === "native" ? stored : "english";
}

function preferredTitle(
  series: Series,
  matches: (entry: SeriesTitle) => boolean,
): string | undefined {
  const titles = (series.titles ?? []).filter((entry) => entry.title && matches(entry));
  return (
    titles.find((entry) => entry.is_primary === true)?.title ??
    titles.find((entry) => entry.traits?.includes("official"))?.title ??
    titles[0]?.title ??
    undefined
  );
}

export function seriesTitle(series: Series): string {
  const english = () =>
    preferredTitle(series, (entry) => entry.language?.toLowerCase().startsWith("en") === true) ??
    series.title ??
    undefined;
  const romanized = () =>
    preferredTitle(series, (entry) => /-latn$/i.test(entry.language ?? "")) ??
    series.romanized_title ??
    undefined;
  const native = () =>
    series.native_title ??
    preferredTitle(
      series,
      (entry) => entry.traits?.includes("native") === true && !/-latn$/i.test(entry.language ?? ""),
    ) ??
    undefined;

  const preference = getTitlePreference();
  const candidates =
    preference === "native"
      ? [native(), romanized(), english()]
      : preference === "romanized"
        ? [romanized(), english(), native()]
        : [english(), romanized(), native()];
  const fallback =
    candidates.find(Boolean) ??
    (series.titles ?? []).find((entry) => entry.title)?.title ??
    `Series ${series.id}`;

  return Application.decodeHTMLEntities(fallback);
}

// Undefined when the series has no artwork at all. Every size is nullable and
// the whole cover object can be missing.
export function seriesThumbnail(series: Series): string | undefined {
  const cover = series.cover;
  for (const url of [cover?.x350, cover?.x250, cover?.raw, cover?.x150]) {
    if (url) return url;
  }
  return undefined;
}

export function seriesSubtitle(series: Series): string | undefined {
  const parts = [series.type, series.status]
    .filter((value): value is string => Boolean(value))
    .map(capitalise);

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

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function typeLabel(series: Series): string | undefined {
  return series.type ? capitalise(series.type) : undefined;
}

export function chaptersLabel(series: Series): string | undefined {
  const total = series.total_chapters;
  if (total == undefined || total <= 0) return undefined;
  return total === 1 ? "1 chapter" : `${total} chapters`;
}

// `final_volume` is the number the series ends on, which is also how many
// volumes there are.
export function volumesLabel(series: Series): string | undefined {
  const final = series.final_volume;
  if (final == undefined || final <= 0) return undefined;
  return final === 1 ? "1 volume" : `${final} volumes`;
}

export function ratingLabel(series: Series): string | undefined {
  const rating = series.rating;
  if (rating == undefined || !Number.isFinite(rating) || rating <= 0) return undefined;
  return (rating / 10).toFixed(2);
}

export function statusLabel(series: Series): string {
  return mapStatus(series.status);
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
  const primaryTitle = seriesTitle(series);
  const seen = new Set([primaryTitle.toLowerCase()]);
  const secondaryTitles: string[] = [];

  for (const candidate of [
    series.native_title,
    series.romanized_title,
    series.title,
    ...(series.titles ?? []).map((entry) => entry.title),
  ]) {
    const title = candidate ? Application.decodeHTMLEntities(candidate) : "";
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
      thumbnailUrl: seriesThumbnail(series) ?? "",
      synopsis: series.description ? Application.decodeHTMLEntities(series.description) : "",
      author: (series.authors ?? []).filter(Boolean).join(", ") || undefined,
      artist: (series.artists ?? []).filter(Boolean).join(", ") || undefined,
      status: mapStatus(series.status),
      rating:
        series.rating == null || !Number.isFinite(series.rating)
          ? undefined
          : Math.min(1, Math.max(0, series.rating / 100)),
      contentRating: contentRatingFor(series),
      contentType: series.type === "novel" ? "novel" : "comic",
      tagGroups: tags.length > 0 ? [{ id: "tags", title: "Tags", tags }] : [],
      shareUrl: `${DOMAIN}/${series.id}`,
    },
  };
}
