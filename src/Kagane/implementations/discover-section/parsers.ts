/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { DiscoverSectionItem } from "@paperback/types";

import type {
  KaganeSeriesDetailsResponse,
  KaganeMetadata,
  KaganeSearchBook,
  LatestChapter,
} from "../shared/models";
import {
  buildImageUrl,
  formatViews,
  joinUnique,
  mapItemContentRating,
  mapPublicationStatus,
  parseKaganeDate,
  resolveGenreNames,
  starRating,
} from "../shared/utils";

// Matches the featured card's info-chip shape (SF Symbol + label).
type InfoItem = { symbol: string; text: string };

function statusLabel(book: KaganeSearchBook): string | undefined {
  const status = mapPublicationStatus(book.publication_status ?? "");
  return status !== "Unknown" ? status : undefined;
}

function detailRating(detail: KaganeSeriesDetailsResponse | undefined): string | undefined {
  return starRating(detail?.average_rating ?? detail?.bayesian_rating);
}

function authorNames(detail: KaganeSeriesDetailsResponse | undefined): string | undefined {
  return joinUnique(
    (detail?.series_staff ?? [])
      .filter((person) => /author|story/i.test(person.role))
      .map((person) => person.name),
  );
}

// A short "Manga • Romance, Fantasy" descriptor for a card subtitle, built
// entirely from the listing payload (no detail fetch).
function descriptor(book: KaganeSearchBook, metadata: KaganeMetadata): string | undefined {
  const bits = [
    book.format?.trim() && book.format.toLowerCase() !== "other" ? book.format : undefined,
    resolveGenreNames(book.genres, metadata.genres, 2).join(", ") || undefined,
  ].filter((bit): bit is string => Boolean(bit));
  return bits.length > 0 ? bits.join(" • ") : undefined;
}

// The Popular hero: author as the supertitle, description as the summary, and a
// star rating + view count as the info chips.
export function mapFeaturedItem(
  book: KaganeSearchBook,
  detail: KaganeSeriesDetailsResponse | undefined,
  metadata: KaganeMetadata,
): DiscoverSectionItem {
  const rating = detailRating(detail);
  const views = formatViews(detail?.total_views);
  const status = statusLabel(book);

  // infoItems is a 1- or 2-element tuple; prefer rating + views, then status.
  const candidates: InfoItem[] = [
    rating ? { symbol: "star.fill", text: rating.replace("★ ", "") } : undefined,
    views ? { symbol: "eye.fill", text: views } : undefined,
    status ? { symbol: "book.closed.fill", text: status } : undefined,
  ].filter((item): item is InfoItem => Boolean(item));
  const infoItems: [InfoItem] | [InfoItem, InfoItem] | undefined =
    candidates.length >= 2
      ? [candidates[0] as InfoItem, candidates[1] as InfoItem]
      : candidates.length === 1
        ? [candidates[0] as InfoItem]
        : undefined;

  return {
    type: "featuredCarouselItem",
    mangaId: book.series_id,
    title: book.title.trim(),
    imageUrl: buildImageUrl(book.cover_image_id),
    contentRating: mapItemContentRating(book.content_rating),
    supertitle: authorNames(detail) ?? statusLabel(book),
    summary: detail?.description?.trim() || descriptor(book, metadata) || "",
    infoItems,
  };
}

// The newest chapter's label ("Vol.1 Ch.3" / "Ch. 27").
function chapterLabel(latest: LatestChapter): string | undefined {
  const chapter = latest.chapter_no?.trim();
  const volume = latest.volume_no?.trim();
  if (chapter) return volume ? `Vol.${volume} Ch.${chapter}` : `Ch. ${chapter}`;
  if (volume) return `Volume ${volume}`;
  return latest.title?.trim() || undefined;
}

// Latest updates card — the newest chapter label as the subtitle and the
// publish time as the relative date, both straight from the listing payload
// (no per-card detail fetch).
export function mapLatestItem(
  book: KaganeSearchBook,
  metadata: KaganeMetadata,
): DiscoverSectionItem {
  const latest = book.latest_chapters?.[0];
  if (!latest?.book_id) return mapSimpleItem(book, metadata);
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: book.series_id,
    chapterId: latest.book_id,
    title: book.title.trim(),
    imageUrl: buildImageUrl(book.cover_image_id),
    contentRating: mapItemContentRating(book.content_rating),
    subtitle: chapterLabel(latest),
    publishDate: parseKaganeDate(latest.available_at ?? latest.created_at),
  };
}

export function mapSimpleItem(
  book: KaganeSearchBook,
  metadata: KaganeMetadata,
): DiscoverSectionItem {
  return {
    type: "simpleCarouselItem",
    mangaId: book.series_id,
    title: book.title.trim(),
    imageUrl: buildImageUrl(book.cover_image_id),
    contentRating: mapItemContentRating(book.content_rating),
    subtitle: descriptor(book, metadata) ?? statusLabel(book),
  };
}
