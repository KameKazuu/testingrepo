/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Form, SettingsFormProviding } from "@paperback/types";
import { CloudflareError } from "@paperback/types";

import { getKaganeMetadata, readCachedMetadata } from "../../services/network";
import {
  CHAPTER_TITLE_MODE_KEY,
  CHAPTER_TITLE_MODE_OPTIONS,
  CONTENT_LANGUAGES_KEY,
  CONTENT_RATING_KEY,
  CUSTOM_HIDDEN_TAGS_KEY,
  DATA_SAVER_KEY,
  EXCLUDED_GENRES_KEY,
  FORMAT_OPTIONS,
  HIDDEN_FORMATS_KEY,
  HIDDEN_TAG_CATEGORIES,
  HIDDEN_TAG_CATEGORIES_KEY,
  CONTENT_RATING_VALUES,
  LANGUAGE_OPTIONS,
  SHOW_EDITION_KEY,
  SHOW_SOURCE_KEY,
  SHOW_SPOILER_TAGS_KEY,
  SOURCE_DISPLAY_MODE_KEY,
  type KaganeContentRating,
} from "../shared/models";
import type { KaganeMetadata } from "../shared/models";
import { KaganeSettingsForm } from "./forms";

function toGenreOptions(metadata: KaganeMetadata): { id: string; title: string }[] {
  return Object.entries(metadata.genres)
    .map(([id, title]) => ({ id, title }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

function readStringArray(key: string, fallback: string[], validIds?: Set<string>): string[] {
  const value = Application.getState(key);
  let raw: unknown = fallback;

  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === "string" && value.trim()) {
    try {
      raw = JSON.parse(value);
    } catch {
      raw = fallback;
    }
  }

  if (!Array.isArray(raw)) return fallback;

  const sanitized = raw.filter((entry): entry is string => {
    return typeof entry === "string" && (!validIds || validIds.has(entry));
  });

  return sanitized.length > 0 || fallback.length === 0 ? sanitized : fallback;
}

const DEFAULT_CONTENT_RATINGS: KaganeContentRating[] = ["safe", "suggestive"];

// Individually selectable content ratings, defaulting to Safe + Suggestive.
export function getContentRatingSelections(): KaganeContentRating[] {
  const value = Application.getState(CONTENT_RATING_KEY);
  // Older builds stored the maximum rating as a single string; expand it to
  // the ladder it implied (e.g. "erotica" meant safe + suggestive + erotica).
  if (typeof value === "string" && CONTENT_RATING_VALUES.includes(value as KaganeContentRating)) {
    const index = CONTENT_RATING_VALUES.indexOf(value as KaganeContentRating);
    return CONTENT_RATING_VALUES.slice(0, index + 1);
  }
  const selections = readStringArray(
    CONTENT_RATING_KEY,
    DEFAULT_CONTENT_RATINGS,
    new Set<string>(CONTENT_RATING_VALUES),
  ) as KaganeContentRating[];
  return selections.length > 0 ? selections : DEFAULT_CONTENT_RATINGS;
}

export function setContentRatingSelections(value: string[]): void {
  const valid = value.filter((entry): entry is KaganeContentRating =>
    CONTENT_RATING_VALUES.includes(entry as KaganeContentRating),
  );
  Application.setState(valid.length > 0 ? valid : DEFAULT_CONTENT_RATINGS, CONTENT_RATING_KEY);
}

export function getSourceDisplayMode(): string {
  const value = Application.getState(SOURCE_DISPLAY_MODE_KEY);
  return value === "official" || value === "scanlations" ? value : "all";
}

export function setSourceDisplayMode(value: string): void {
  Application.setState(
    value === "official" || value === "scanlations" ? value : "all",
    SOURCE_DISPLAY_MODE_KEY,
  );
}

export function getShowEdition(): boolean {
  return (Application.getState(SHOW_EDITION_KEY) as boolean | undefined) ?? false;
}

export function setShowEdition(value: boolean): void {
  Application.setState(value, SHOW_EDITION_KEY);
}

export function getShowSource(): boolean {
  return (Application.getState(SHOW_SOURCE_KEY) as boolean | undefined) ?? false;
}

export function setShowSource(value: boolean): void {
  Application.setState(value, SHOW_SOURCE_KEY);
}

export function getDataSaver(): boolean {
  return (Application.getState(DATA_SAVER_KEY) as boolean | undefined) ?? false;
}

export function setDataSaver(value: boolean): void {
  Application.setState(value, DATA_SAVER_KEY);
}

// Spoiler-flagged genres/tags are hidden on the details page unless the reader
// opts in.
export function getShowSpoilerTags(): boolean {
  return (Application.getState(SHOW_SPOILER_TAGS_KEY) as boolean | undefined) ?? false;
}

export function setShowSpoilerTags(value: boolean): void {
  Application.setState(value, SHOW_SPOILER_TAGS_KEY);
}

export function getChapterTitleMode(): string {
  const value = Application.getState(CHAPTER_TITLE_MODE_KEY);
  return typeof value === "string" &&
    CHAPTER_TITLE_MODE_OPTIONS.some((option) => option.id === value)
    ? value
    : "optional";
}

export function setChapterTitleMode(value: string): void {
  Application.setState(
    CHAPTER_TITLE_MODE_OPTIONS.some((option) => option.id === value) ? value : "optional",
    CHAPTER_TITLE_MODE_KEY,
  );
}

// Excluded genres are stored as genre taxonomy UUIDs (the option ids used by
// the settings SelectRow), so they drop straight into the search body.
export function getExcludedGenres(): string[] {
  return readStringArray(EXCLUDED_GENRES_KEY, []);
}

export function setExcludedGenres(value: string[]): void {
  Application.setState(value, EXCLUDED_GENRES_KEY);
}

// Formats hidden from the home page, listings, and search.
export function getHiddenFormats(): string[] {
  return readStringArray(HIDDEN_FORMATS_KEY, [], new Set(FORMAT_OPTIONS));
}

export function setHiddenFormats(value: string[]): void {
  Application.setState(value, HIDDEN_FORMATS_KEY);
}

// Selected preset hide-categories (by category id).
export function getHiddenTagCategories(): string[] {
  return readStringArray(
    HIDDEN_TAG_CATEGORIES_KEY,
    [],
    new Set(HIDDEN_TAG_CATEGORIES.map((category) => category.id)),
  );
}

export function setHiddenTagCategories(value: string[]): void {
  Application.setState(value, HIDDEN_TAG_CATEGORIES_KEY);
}

// Every tag UUID covered by the selected preset categories.
export function getHiddenTagCategoryIds(): string[] {
  const selected = new Set(getHiddenTagCategories());
  return HIDDEN_TAG_CATEGORIES.filter((category) => selected.has(category.id)).flatMap(
    (category) => category.tagIds,
  );
}

// Free-text tag names to hide, resolved against the taxonomy at search time.
export function getCustomHiddenTags(): string[] {
  return readStringArray(CUSTOM_HIDDEN_TAGS_KEY, []);
}

export function setCustomHiddenTags(value: string[]): void {
  Application.setState(value.map((entry) => entry.trim()).filter(Boolean), CUSTOM_HIDDEN_TAGS_KEY);
}

export function getContentLanguages(): string[] {
  return readStringArray(
    CONTENT_LANGUAGES_KEY,
    ["en"],
    new Set(LANGUAGE_OPTIONS.map((option) => option.id)),
  );
}

export function setContentLanguages(value: string[]): void {
  const validIds = new Set(LANGUAGE_OPTIONS.map((option) => option.id));
  const sanitized = value.filter((entry) => validIds.has(entry));
  Application.setState(sanitized.length > 0 ? sanitized : ["en"], CONTENT_LANGUAGES_KEY);
}

export class SettingsFormProvider implements SettingsFormProviding {
  async getSettingsForm(): Promise<Form> {
    // Excluded-genre options come from the live taxonomy (id = UUID) so the
    // SelectRow ids are always valid.
    let genreOptions: { id: string; title: string }[] = [];
    try {
      genreOptions = toGenreOptions(await getKaganeMetadata());
    } catch (error) {
      // A challenge must surface so the app can raise the bypass — swallowing
      // it here is what left the picker empty. For any other failure, fall
      // back to the last cached taxonomy rather than showing nothing.
      if (error instanceof CloudflareError) throw error;
      const cached = readCachedMetadata();
      genreOptions = cached ? toGenreOptions(cached) : [];
    }
    return new KaganeSettingsForm(genreOptions);
  }
}
