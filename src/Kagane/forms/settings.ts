/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  Section,
  SelectRow,
  ToggleRow,
  URL,
} from "@paperback/types";

import {
  API_URL_KEY,
  BASE_URL_KEY,
  CHAPTER_FORMAT_DEFAULT,
  CHAPTER_FORMAT_KEY,
  CHAPTER_FORMAT_OPTIONS,
  CONTENT_RATING_KEY,
  CONTENT_RATINGS,
  DATA_SAVER_KEY,
  DEFAULT_API_URL,
  DEFAULT_DOMAIN,
  SHOW_SCANLATOR_KEY,
} from "../models";

// Read a stored override, normalised. Returns undefined when nothing usable is
// stored so callers can fall back to the compiled-in default.
function readOverride(key: string): string | undefined {
  const value = Application.getState(key);
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

/** Live website origin — honours a reader's override, else the default. */
export function getDomain(): string {
  return readOverride(BASE_URL_KEY) ?? DEFAULT_DOMAIN;
}

/** Live API origin — honours a reader's override, else the default. */
export function getApiUrl(): string {
  return readOverride(API_URL_KEY) ?? DEFAULT_API_URL;
}

/** Whether to request the server's data-saver (compressed) page images. */
export function getDataSaver(): boolean {
  return Application.getState(DATA_SAVER_KEY) === true;
}

// Stored max content rating (index into CONTENT_RATINGS); defaults to the most
// explicit, i.e. show everything.
function getMaxRatingIndex(): number {
  const stored = Application.getState(CONTENT_RATING_KEY);
  const index = typeof stored === "string" ? CONTENT_RATINGS.indexOf(stored as never) : -1;
  return index >= 0 ? index : CONTENT_RATINGS.length - 1;
}

/**
 * Ratings to send as the search `content_rating` filter — every rating up to
 * the chosen max. Returns undefined when everything is allowed so the filter
 * is omitted entirely.
 */
export function getContentRatings(): string[] | undefined {
  const index = getMaxRatingIndex();
  if (index >= CONTENT_RATINGS.length - 1) return undefined;
  return CONTENT_RATINGS.slice(0, index + 1);
}

/** Chapter-title format id (see CHAPTER_FORMAT_OPTIONS). */
export function getChapterFormat(): string {
  const stored = Application.getState(CHAPTER_FORMAT_KEY);
  return typeof stored === "string" && stored.length > 0 ? stored : CHAPTER_FORMAT_DEFAULT;
}

/** Whether to append the scanlation group to each chapter title. */
export function getShowScanlator(): boolean {
  return Application.getState(SHOW_SCANLATOR_KEY) === true;
}

// Normalise before persisting: a scheme-less or malformed value would make
// every `new URL(...)` throw and brick the source. Empty clears the override;
// undefined signals the input couldn't be parsed and should be ignored.
function setOverride(key: string, value: string): string | undefined {
  let trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) {
    Application.setState("", key);
    return "";
  }
  if (!/^https?:\/\//i.test(trimmed)) trimmed = `https://${trimmed}`;
  try {
    new URL(trimmed).toString();
  } catch {
    return undefined;
  }
  Application.setState(trimmed, key);
  return trimmed;
}

// Cloudflare-protected sites occasionally move hosts; letting readers point at
// the current website/API address keeps the source working between updates.
export class KaganeSettingsForm extends Form {
  private baseUrl: string;
  private apiUrl: string;
  private dataSaver: boolean;
  private maxRating: string;
  private chapterFormat: string;
  private showScanlator: boolean;

  constructor() {
    super();
    this.baseUrl = readOverride(BASE_URL_KEY) ?? "";
    this.apiUrl = readOverride(API_URL_KEY) ?? "";
    this.dataSaver = getDataSaver();
    const storedRating = Application.getState(CONTENT_RATING_KEY);
    this.maxRating =
      typeof storedRating === "string" && CONTENT_RATINGS.includes(storedRating as never)
        ? storedRating
        : CONTENT_RATINGS[CONTENT_RATINGS.length - 1];
    this.chapterFormat = getChapterFormat();
    this.showScanlator = getShowScanlator();
  }

  override getSections() {
    return [
      Section(
        {
          id: "content_rating",
          footer:
            "Hide titles above the chosen rating. Safe is family-friendly; Suggestive adds mild " +
            "fan service; Erotica adds sexual content and mature themes; Pornographic includes " +
            "explicit material.",
        },
        [
          SelectRow("max_rating", {
            title: "Content Rating",
            value: [this.maxRating],
            options: CONTENT_RATINGS.map((rating) => ({ id: rating, title: rating })),
            minItemCount: 1,
            maxItemCount: 1,
            onValueChange: Application.Selector(this as KaganeSettingsForm, "updateMaxRating"),
          }),
        ],
      ),
      Section(
        {
          id: "chapters",
          footer: "How chapter titles are shown in the chapter list.",
        },
        [
          SelectRow("chapter_format", {
            title: "Chapter Title Format",
            value: [this.chapterFormat],
            options: CHAPTER_FORMAT_OPTIONS.map((option) => ({
              id: option.id,
              title: option.title,
            })),
            minItemCount: 1,
            maxItemCount: 1,
            onValueChange: Application.Selector(this as KaganeSettingsForm, "updateChapterFormat"),
          }),
          ToggleRow("show_scanlator", {
            title: "Show Source in Title",
            value: this.showScanlator,
            onValueChange: Application.Selector(this as KaganeSettingsForm, "updateShowScanlator"),
          }),
        ],
      ),
      Section(
        {
          id: "reading",
          footer:
            "Data saver requests smaller, more compressed page images. Turn it off for the " +
            "highest quality.",
        },
        [
          ToggleRow("data_saver", {
            title: "Data saver",
            value: this.dataSaver,
            onValueChange: Application.Selector(this as KaganeSettingsForm, "updateDataSaver"),
          }),
        ],
      ),
      Section(
        {
          id: "base_url",
          footer:
            "Override the website address if Kagane has moved. Leave empty for the default " +
            `(${DEFAULT_DOMAIN}). Include the scheme, e.g. https://kagane.to`,
        },
        [
          InputRow("base_url_input", {
            title: "Website URL",
            value: this.baseUrl,
            onValueChange: Application.Selector(this as KaganeSettingsForm, "updateBaseUrl"),
          }),
          LabelRow("base_url_current", { title: "Currently using", value: getDomain() }),
        ],
      ),
      Section(
        {
          id: "api_url",
          footer:
            "Override the API address only if the default stops responding. Leave empty for the " +
            `default (${DEFAULT_API_URL}).`,
        },
        [
          InputRow("api_url_input", {
            title: "API URL",
            value: this.apiUrl,
            onValueChange: Application.Selector(this as KaganeSettingsForm, "updateApiUrl"),
          }),
          LabelRow("api_url_current", { title: "Currently using", value: getApiUrl() }),
          ButtonRow("reset", {
            title: "Reset to defaults",
            onSelect: Application.Selector(this as KaganeSettingsForm, "resetOverrides"),
          }),
        ],
      ),
    ];
  }

  async updateDataSaver(value: boolean): Promise<void> {
    this.dataSaver = value;
    Application.setState(value, DATA_SAVER_KEY);
  }

  async updateMaxRating(value: string[]): Promise<void> {
    const rating = value[0];
    if (!rating || !CONTENT_RATINGS.includes(rating as never)) return;
    this.maxRating = rating;
    Application.setState(rating, CONTENT_RATING_KEY);
    Application.invalidateDiscoverSections();
  }

  async updateChapterFormat(value: string[]): Promise<void> {
    const format = value[0];
    if (!format) return;
    this.chapterFormat = format;
    Application.setState(format, CHAPTER_FORMAT_KEY);
  }

  async updateShowScanlator(value: boolean): Promise<void> {
    this.showScanlator = value;
    Application.setState(value, SHOW_SCANLATOR_KEY);
  }

  async updateBaseUrl(value: string): Promise<void> {
    const stored = setOverride(BASE_URL_KEY, value);
    if (stored !== undefined) {
      this.baseUrl = stored;
      Application.invalidateDiscoverSections();
    }
    this.reloadForm();
  }

  async updateApiUrl(value: string): Promise<void> {
    const stored = setOverride(API_URL_KEY, value);
    if (stored !== undefined) {
      this.apiUrl = stored;
      Application.invalidateDiscoverSections();
    }
    this.reloadForm();
  }

  async resetOverrides(): Promise<void> {
    this.baseUrl = "";
    this.apiUrl = "";
    setOverride(BASE_URL_KEY, "");
    setOverride(API_URL_KEY, "");
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }
}
