/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Tag } from "@paperback/types";

import { discoverySections, SAFE_ID_REGEX, type SearchMetadata } from "./models";

export function normalizeId(id: string): string {
  return id
    .replaceAll("%", "%25")
    .replaceAll("&", "%26")
    .replaceAll("-", "@#@")
    .replaceAll("'", "&#@")
    .replaceAll(" ", "#@&")
    .replace(SAFE_ID_REGEX, (character) => {
      const encoded = encodeURIComponent(character);
      return encoded === character ? "-" : encoded;
    });
}

export function deNormalizeId(id: string): string {
  return decodeURIComponent(
    id.replace(/@#@|&#@|#@&/g, (token) => (token === "@#@" ? "-" : token === "&#@" ? "'" : " ")),
  );
}

export function getContentTypes() {
  return (Application.getState("content_type") as string[] | undefined) ?? [""];
}

export function getSectionContentTypes() {
  return (Application.getState("section_content_type") as string[] | undefined) ?? [""];
}

export function getGenresHidden() {
  return (Application.getState("hidden_genres") as string[] | undefined) ?? [];
}

export function getDemographicHidden() {
  return (Application.getState("hidden_demographic") as string[] | undefined) ?? [];
}

export function getThemesHidden() {
  return (Application.getState("hidden_themes") as string[] | undefined) ?? [];
}

export function getMoreHidden() {
  return (Application.getState("hidden_more") as string[] | undefined) ?? [];
}

export function getEnglishOnly() {
  return (Application.getState("english_only_content") as boolean | undefined) ?? false;
}

export function getShowAdultStatus(): string[] {
  return (Application.getState("show_adult_content") as string[] | undefined) ?? ["0"];
}

export function getTimeRangeStatus(): string[] {
  return (Application.getState("content_range") as string[] | undefined) ?? [""];
}

export function getRangeStatus(): boolean {
  return (Application.getState("range_type") as boolean | undefined) ?? false;
}

export function getMultipageStatus(): boolean {
  return (Application.getState("multipage_section") as boolean | undefined) ?? false;
}

export function getDiscoverySectionsOrder() {
  return (
    (Application.getState("sections") as { id: string; title: string }[] | undefined) ??
    discoverySections
  );
}

export function generateTagElement(tag: string): Tag {
  return {
    id: normalizeId(tag),
    title: deNormalizeId(tag),
  };
}

export function defaultMetadata(filterItem: string = ""): SearchMetadata {
  return {
    genres: {
      ...Object.fromEntries(getGenresHidden().map((item) => [item, "excluded" as const])),
      ...(filterItem.length > 0 ? { [filterItem]: "included" as const } : {}),
    },
    demographic: Object.fromEntries(
      getDemographicHidden().map((item) => [item, "excluded" as const]),
    ),
    themes: Object.fromEntries(getThemesHidden().map((item) => [item, "excluded" as const])),
    more: Object.fromEntries(getMoreHidden().map((item) => [item, "excluded" as const])),
    origin: getContentTypes().filter((type) => type !== ""),
    adult: getShowAdultStatus(),
  };
}

export function getFilters(): GenreFilters {
  return (
    (Application.getState("mangadot_filters") as GenreFilters | undefined) ?? {
      demographic: [],
      genre: [],
      more: [],
      themeAndContent: [],
      language: [],
    }
  );
}

type GenreCategory = "Demographic" | "Genre" | "Theme & content" | "More";

const CATEGORY_MAP: Record<string, Exclude<GenreCategory, "More">> = {
  Shounen: "Demographic",
  Seinen: "Demographic",
  Shoujo: "Demographic",
  Josei: "Demographic",
  Kids: "Demographic",

  Action: "Genre",
  Adventure: "Genre",
  Comedy: "Genre",
  Drama: "Genre",
  Fantasy: "Genre",
  Horror: "Genre",
  Mystery: "Genre",
  Romance: "Genre",
  "Sci-Fi": "Genre",
  "Slice of Life": "Genre",
  Sports: "Genre",
  Thriller: "Genre",
  Tragedy: "Genre",
  Psychological: "Genre",
  Supernatural: "Genre",
  Mecha: "Genre",
  Historical: "Genre",

  Isekai: "Theme & content",
  Ecchi: "Theme & content",
  Harem: "Theme & content",
  "Martial Arts": "Theme & content",
  "School Life": "Theme & content",
  Magic: "Theme & content",
  Military: "Theme & content",
  Music: "Theme & content",
  Demons: "Theme & content",
  Vampire: "Theme & content",
  Game: "Theme & content",
  Cooking: "Theme & content",
  Medical: "Theme & content",
  Webtoon: "Theme & content",
};

export interface GenreFilters {
  demographic: Tag[];
  genre: Tag[];
  themeAndContent: Tag[];
  more: Tag[];
  language: Tag[];
}
export function groupGenres(genres: readonly string[]): GenreFilters {
  const grouped: GenreFilters = {
    demographic: [],
    genre: [],
    themeAndContent: [],
    more: [],
    language: [],
  };

  for (const genre of genres) {
    switch (CATEGORY_MAP[genre]) {
      case "Demographic":
        grouped.demographic.push(generateTagElement(genre));
        break;

      case "Genre":
        grouped.genre.push(generateTagElement(genre));
        break;

      case "Theme & content":
        grouped.themeAndContent.push(generateTagElement(genre));
        break;

      default:
        grouped.more.push(generateTagElement(genre));
        break;
    }
  }

  return grouped;
}
