/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ButtonRow, Form, InputRow, LabelRow, Section, ToggleRow, URL } from "@paperback/types";

import {
  API_URL_KEY,
  BASE_URL_KEY,
  DATA_SAVER_KEY,
  DEFAULT_API_URL,
  DEFAULT_DOMAIN,
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

  constructor() {
    super();
    this.baseUrl = readOverride(BASE_URL_KEY) ?? "";
    this.apiUrl = readOverride(API_URL_KEY) ?? "";
    this.dataSaver = getDataSaver();
  }

  override getSections() {
    return [
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
