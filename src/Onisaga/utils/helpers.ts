/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

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
