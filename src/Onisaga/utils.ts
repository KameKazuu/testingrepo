/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { type CheerioAPI } from "cheerio";

import {
  DEFAULT_SORT,
  DOMAIN,
  GENRES,
  GENRES_FETCHED_KEY,
  GENRES_KEY,
  GENRES_TTL,
  type BrowseLivewireRequest,
  type ChapterLivewireRequest,
  type LivewireState,
  type Option,
  type PostFilterUpdates,
  type ToggleLivewireRequest,
} from "./models";

// ----- General helpers -----

// iOS swaps straight quotes for curly ones; the site only matches the straight
// forms, so normalize before searching.
export function straightenQuotes(value: string): string {
  return value.replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"');
}

// Slug from a /manga/<slug> href (absolute or relative).
export function mangaIdFromHref(href: string): string {
  const path = href.startsWith("http") ? href.replace(/^https?:\/\/[^/]+/, "") : href;
  const after = path.split("/manga/")[1] ?? "";
  return after.replace(/^\/+|\/+$/g, "");
}

// Root-relative path from a chapter href (used verbatim as the chapter id).
export function chapterIdFromHref(href: string): string {
  const path = href.startsWith("http") ? href.replace(/^https?:\/\/[^/]+/, "") : href;
  return path.startsWith("/") ? path : `/${path}`;
}

export function parseJson<T>(raw: string, context: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Failed to parse ${context}`, { cause: error });
  }
}

// ----- Genre cache -----

// The genre list shown in search, the Genres rail and the blacklist: the copy
// fetched from the site if present, otherwise the bundled fallback so the source
// works before the first fetch (or if it fails).
export function getGenres(): Option[] {
  const cached = Application.getState(GENRES_KEY) as Option[] | undefined;
  return cached && cached.length > 0 ? cached : GENRES;
}

export function cacheGenres(genres: Option[], now: number): void {
  Application.setState(genres, GENRES_KEY);
  Application.setState(now, GENRES_FETCHED_KEY);
}

// True when the cache is empty or older than the TTL, so it's worth refetching.
export function genresAreStale(now: number): boolean {
  const at = (Application.getState(GENRES_FETCHED_KEY) as number | undefined) ?? 0;
  return now - at > GENRES_TTL;
}

// ----- Livewire protocol -----

// Headers a Livewire `POST /livewire/update` expects (JSON body, XHR marker).
export function livewireHeaders(referer: string): Record<string, string> {
  return {
    "X-Livewire": "",
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/json",
    Origin: DOMAIN,
    Referer: referer,
  };
}

// Invoke a single Livewire method (setPeriod / setSort / setPlatform) on a
// rail's component to switch its time range / platform and re-render its cards.
export function buildSectionToggleRequest(
  state: LivewireState,
  method: string,
  value: string,
): ToggleLivewireRequest {
  return {
    _token: state.token,
    components: [
      {
        snapshot: state.snapshot,
        updates: {},
        calls: [{ type: "call", path: "", method, params: [value] }],
      },
    ],
  };
}

export function defaultUpdates(): PostFilterUpdates {
  return {
    platform: "",
    status: "",
    sort: DEFAULT_SORT,
    min_chapters: "",
    group: null,
    release_start: null,
    release_end: null,
    genre: [],
    excludeGenre: [],
  };
}

export function isDefaultUpdates(updates: PostFilterUpdates): boolean {
  return (
    updates.platform === "" &&
    updates.status === "" &&
    updates.sort === DEFAULT_SORT &&
    updates.min_chapters === "" &&
    updates.group === null &&
    updates.release_start === null &&
    updates.release_end === null &&
    updates.genre.length === 0 &&
    updates.excludeGenre.length === 0
  );
}

// The Livewire snapshot lives in a `wire:snapshot` attribute on the component
// root; the CSRF token is a `<meta name="csrf-token">` (or an `_token` input).
// Match the component by name appearing inside the snapshot JSON, mirroring the
// reference implementation.
export function extractLivewireState(
  $: CheerioAPI,
  componentName: string,
): LivewireState | undefined {
  const token =
    $("meta[name=csrf-token]").attr("content")?.trim() ||
    $("input[name=_token]").attr("value")?.trim();
  if (!token) return undefined;

  let snapshot: string | undefined;
  $("[wire\\:snapshot]").each((_, el) => {
    if (snapshot) return;
    const value = $(el).attr("wire:snapshot");
    if (value && value.includes(componentName)) {
      snapshot = value;
    }
  });

  if (!snapshot) return undefined;
  return { token, snapshot };
}

export function buildBrowseRequest(
  state: LivewireState,
  updates: PostFilterUpdates,
  page: number,
): BrowseLivewireRequest {
  return {
    _token: state.token,
    components: [
      {
        snapshot: state.snapshot,
        updates,
        calls: [{ type: "call", path: "", method: "gotoPage", params: [page] }],
      },
    ],
  };
}

// Pull the entire chapter (and volume) list in a single Livewire round-trip by
// setting the component's loaded-counts straight to a number larger than any
// series, instead of repeatedly calling loadMoreChapters.
export function buildLoadMoreChaptersRequest(state: LivewireState): ChapterLivewireRequest {
  return {
    _token: state.token,
    components: [
      {
        snapshot: state.snapshot,
        updates: { chaptersLoaded: 3000, volumesLoaded: 3000 },
        calls: [],
      },
    ],
  };
}
