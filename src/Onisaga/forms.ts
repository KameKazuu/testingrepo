/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  AdvancedSearchForm,
  ButtonRow,
  Form,
  Section,
  SelectRow,
  ToggleRow,
  TriStateSelectRow,
  type SearchQuery,
  type Tag,
} from "@paperback/types";

import {
  DEFAULT_IMAGE_RATE_LIMIT_MS,
  DISCOVER_STATUS_KEY,
  DISCOVER_TYPE_KEY,
  EXCLUDED_GENRES_KEY,
  GENRES,
  MIN_CHAPTERS_OPTIONS,
  RATE_LIMIT_KEY,
  SHOW_NSFW_KEY,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  type Option,
  type OnisagaSearchMetadata,
} from "./models";

// ----- Settings state accessors -----

export function getShowNsfw(): boolean {
  return (Application.getState(SHOW_NSFW_KEY) as boolean | undefined) ?? false;
}

export function getDiscoverType(): string {
  return (Application.getState(DISCOVER_TYPE_KEY) as string | undefined) ?? "";
}

export function getDiscoverStatus(): string {
  return (Application.getState(DISCOVER_STATUS_KEY) as string | undefined) ?? "";
}

export function getExcludedGenres(): string[] {
  return (Application.getState(EXCLUDED_GENRES_KEY) as string[] | undefined) ?? [];
}

export function getImageRateLimitMs(): number {
  return (
    (Application.getState(RATE_LIMIT_KEY) as number | undefined) ?? DEFAULT_IMAGE_RATE_LIMIT_MS
  );
}

const RATE_LIMIT_OPTIONS: Option[] = [
  { id: "1500", title: "1 image / 1.50s" },
  { id: "1750", title: "1 image / 1.75s" },
  { id: "2000", title: "1 image / 2.00s" },
  { id: "2250", title: "1 image / 2.25s" },
  { id: "2500", title: "1 image / 2.50s" },
];

const toTags = (options: Option[]): Tag[] => options.map((o) => ({ id: o.id, title: o.title }));

// ----- Settings form -----

export class OnisagaSettingsForm extends Form {
  private showNsfw: boolean;
  private type: string;
  private status: string;
  private excludedGenres: string[];
  private rateLimit: string;

  constructor() {
    super();
    this.showNsfw = getShowNsfw();
    this.type = getDiscoverType();
    this.status = getDiscoverStatus();
    this.excludedGenres = getExcludedGenres();
    this.rateLimit = String(getImageRateLimitMs());
  }

  override getSections() {
    return [
      Section(
        {
          id: "content",
          footer: "Show 18+ titles in browse, search and discover. Hidden by default.",
        },
        [
          ToggleRow("showNsfw", {
            title: "Show NSFW / 18+ Content",
            value: this.showNsfw,
            onValueChange: Application.Selector(this as OnisagaSettingsForm, "updateShowNsfw"),
          }),
        ],
      ),
      Section(
        {
          id: "discoverFilters",
          footer: "Applies to the Popular, Latest, Top Rated and Fan Favorites sections.",
        },
        [
          SelectRow("type", {
            title: "Type",
            value: this.type ? [this.type] : [],
            options: toTags(TYPE_OPTIONS),
            minItemCount: 0,
            maxItemCount: 1,
            onValueChange: Application.Selector(this as OnisagaSettingsForm, "updateType"),
          }),
          SelectRow("status", {
            title: "Status",
            value: this.status ? [this.status] : [],
            options: toTags(STATUS_OPTIONS),
            minItemCount: 0,
            maxItemCount: 1,
            onValueChange: Application.Selector(this as OnisagaSettingsForm, "updateStatus"),
          }),
        ],
      ),
      Section(
        { id: "blacklist", footer: "Exclude these genres from browse, search and discover." },
        [
          SelectRow("excludedGenres", {
            title: "Genre Blacklist",
            value: this.excludedGenres,
            options: toTags(GENRES),
            minItemCount: 0,
            maxItemCount: GENRES.length,
            onValueChange: Application.Selector(
              this as OnisagaSettingsForm,
              "updateExcludedGenres",
            ),
          }),
          ButtonRow("resetFilters", {
            title: "Reset Content Filters",
            onSelect: Application.Selector(this as OnisagaSettingsForm, "resetFilters"),
          }),
        ],
      ),
      Section(
        {
          id: "rateLimit",
          footer:
            "Delay between page-image requests. Lowering this may cause 429 errors that last 15-30 minutes.",
        },
        [
          SelectRow("rateLimit", {
            title: "Image Requests Limit",
            value: [this.rateLimit],
            options: toTags(RATE_LIMIT_OPTIONS),
            minItemCount: 1,
            maxItemCount: 1,
            onValueChange: Application.Selector(this as OnisagaSettingsForm, "updateRateLimit"),
          }),
        ],
      ),
    ];
  }

  async updateShowNsfw(value: boolean): Promise<void> {
    this.showNsfw = value;
    Application.setState(value, SHOW_NSFW_KEY);
  }

  async updateType(value: string[]): Promise<void> {
    this.type = value[0] ?? "";
    Application.setState(this.type, DISCOVER_TYPE_KEY);
  }

  async updateStatus(value: string[]): Promise<void> {
    this.status = value[0] ?? "";
    Application.setState(this.status, DISCOVER_STATUS_KEY);
  }

  async updateExcludedGenres(value: string[]): Promise<void> {
    this.excludedGenres = value;
    Application.setState(value, EXCLUDED_GENRES_KEY);
  }

  async resetFilters(): Promise<void> {
    this.excludedGenres = [];
    Application.setState([], EXCLUDED_GENRES_KEY);
    this.reloadForm();
  }

  async updateRateLimit(value: string[]): Promise<void> {
    this.rateLimit = value[0] ?? String(DEFAULT_IMAGE_RATE_LIMIT_MS);
    Application.setState(Number(this.rateLimit), RATE_LIMIT_KEY);
  }
}

// ----- Advanced search form -----

export class OnisagaAdvancedSearchForm extends AdvancedSearchForm {
  private type: string;
  private status: string;
  private minChapters: string;
  private genres: Record<string, "included" | "excluded">;

  private readonly genreOptions: Tag[];

  constructor(searchQuery: SearchQuery<OnisagaSearchMetadata>) {
    super();
    const meta = searchQuery.metadata ?? {};
    this.type = meta.type ?? "";
    this.status = meta.status ?? "";
    this.minChapters = meta.minChapters ?? "";
    this.genres = { ...meta.genres };
    this.genreOptions = toTags(GENRES);
  }

  override getSections() {
    return [
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(this as OnisagaAdvancedSearchForm, "handleGenres"),
        }),
      ]),
      Section("type", [
        SelectRow("type", {
          title: "Type",
          value: this.type ? [this.type] : [],
          options: toTags(TYPE_OPTIONS),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as OnisagaAdvancedSearchForm, "handleType"),
        }),
      ]),
      Section("status", [
        SelectRow("status", {
          title: "Status",
          value: this.status ? [this.status] : [],
          options: toTags(STATUS_OPTIONS),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as OnisagaAdvancedSearchForm, "handleStatus"),
        }),
      ]),
      Section("minChapters", [
        SelectRow("minChapters", {
          title: "Min Chapters",
          value: this.minChapters ? [this.minChapters] : [],
          options: toTags(MIN_CHAPTERS_OPTIONS),
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as OnisagaAdvancedSearchForm,
            "handleMinChapters",
          ),
        }),
      ]),
    ];
  }

  async handleGenres(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  async handleType(value: string[]): Promise<void> {
    this.type = value[0] ?? "";
  }

  async handleStatus(value: string[]): Promise<void> {
    this.status = value[0] ?? "";
  }

  async handleMinChapters(value: string[]): Promise<void> {
    this.minChapters = value[0] ?? "";
  }

  override getSearchQueryMetadata(): OnisagaSearchMetadata {
    const result: OnisagaSearchMetadata = {};
    if (Object.keys(this.genres).length > 0) result.genres = this.genres;
    if (this.type) result.type = this.type;
    if (this.status) result.status = this.status;
    if (this.minChapters) result.minChapters = this.minChapters;
    return result;
  }
}
