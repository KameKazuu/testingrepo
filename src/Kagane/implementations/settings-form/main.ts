/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Form, SettingsFormProviding } from "@paperback/types";

import { getKaganeMetadata } from "../../services/network";
import {
  CHAPTER_TITLE_MODE_KEY,
  CHAPTER_TITLE_MODE_OPTIONS,
  CONTENT_LANGUAGES_KEY,
  CONTENT_RATING_KEY,
  DATA_SAVER_KEY,
  EXCLUDED_GENRES_KEY,
  LANGUAGE_OPTIONS,
  SHOW_EDITION_KEY,
  SHOW_SOURCE_KEY,
  SHOW_SPOILER_TAGS_KEY,
  SOURCE_DISPLAY_MODE_KEY,
  type KaganeContentRating,
} from "../shared/models";
import { normalizeContentRating } from "../shared/utils";
import { KaganeSettingsForm } from "./forms";

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

export function getContentRatingSetting(): KaganeContentRating {
  return normalizeContentRating(Application.getState(CONTENT_RATING_KEY));
}

export function setContentRatingSetting(value: string): void {
  Application.setState(normalizeContentRating(value), CONTENT_RATING_KEY);
}

export function getSourceDisplayMode(): string {
  return Application.getState(SOURCE_DISPLAY_MODE_KEY) === "official" ? "official" : "all";
}

export function setSourceDisplayMode(value: string): void {
  Application.setState(value === "official" ? "official" : "all", SOURCE_DISPLAY_MODE_KEY);
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
    // SelectRow ids are always valid; fall back to an empty list if the
    // metadata can't be fetched.
    let genreOptions: { id: string; title: string }[] = [];
    try {
      const metadata = await getKaganeMetadata();
      genreOptions = Object.entries(metadata.genres)
        .map(([id, title]) => ({ id, title }))
        .sort((left, right) => left.title.localeCompare(right.title));
    } catch {
      genreOptions = [];
    }
    return new KaganeSettingsForm(genreOptions);
  }
}
