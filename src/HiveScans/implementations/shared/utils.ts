/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { HiveScansPost } from "./models";

export function applyMixins(derivedCtor: any, constructors: any[]) {
  constructors.forEach((baseCtor) => {
    Object.getOwnPropertyNames(baseCtor.prototype).forEach((name) => {
      Object.defineProperty(
        derivedCtor.prototype,
        name,
        Object.getOwnPropertyDescriptor(baseCtor.prototype, name) || Object.create(null),
      );
    });
  });
}

export function normalizeSearchTerm(term: string): string {
  return term
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ");
}

export function encodeMangaId(slug: string): string {
  return encodeURIComponent(slug).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function decodeMangaId(value: string): string {
  return decodeURIComponent(value);
}

export function isNovel(post: Pick<HiveScansPost, "isNovel" | "seriesType">): boolean {
  return post.isNovel === true || (post.seriesType ?? "").toUpperCase() === "NOVEL";
}

export function formatSeriesSubtitle(type?: string | null, status?: string | null): string {
  return [type, status]
    .filter((value): value is string => Boolean(value))
    .map((value) =>
      value
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase()),
    )
    .join(" • ");
}

export function mapStatus(status?: string | null): string {
  switch ((status ?? "").toUpperCase()) {
    case "ONGOING":
    case "COMING_SOON":
      return "Ongoing";
    case "COMPLETED":
    case "MASS_RELEASED":
      return "Completed";
    case "CANCELLED":
    case "DROPPED":
      return "Cancelled";
    default:
      return "Unknown";
  }
}

export function cleanField(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed.toLowerCase() === "n/a") return undefined;
  return trimmed;
}

export function stripHtml(html: string): string {
  if (!html) return "";
  return Application.decodeHTMLEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .trim(),
  );
}
