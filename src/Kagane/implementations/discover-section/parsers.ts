/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { DiscoverSectionItem } from "@paperback/types";

import type { DetailsDto, KaganeMetadata, KaganeSearchBook } from "../shared/models";

// Matches the featured card's info-chip shape (SF Symbol + label).
type InfoItem = { symbol: string; text: string };
import {
  buildImageUrl,
  formatViews,
  joinUnique,
  mapItemContentRating,
  mapPublicationStatus,
  parseKaganeDate,
  resolveGenreNames,
} from "../shared/utils";

function statusLabel(book: KaganeSearchBook): string | undefined {
  const status = mapPublicationStatus(book.publication_status ?? "");
  return status !== "Unknown" ? status : undefined;
}

// A short "Manga • Romance, Fantasy" descriptor for a card subtitle.
function descriptor(book: KaganeSearchBook, metadata: KaganeMetadata): string | undefined {
  const bits = [
    book.format?.trim() && book.format.toLowerCase() !== "other" ? book.format : undefined,
    resolveGenreNames(book.genres, metadata.genres, 2).join(", ") || undefined,
  ].filter((bit): bit is string => Boolean(bit));
  return bits.length > 0 ? bits.join(" • ") : undefined;
}

// The Popular hero. `detail` (when fetched) enriches it with description,
// authors, rating and view count; without it the card still carries genre and
// status info from the listing.
export function mapFeaturedItem(
  book: KaganeSearchBook,
  detail: DetailsDto | undefined,
  metadata: KaganeMetadata,
): DiscoverSectionItem {
  const authors = joinUnique(
    (detail?.series_staff ?? [])
      .filter((person) => /author|story/i.test(person.role))
      .map((person) => person.name),
  );
  const rating = detail?.average_rating ?? detail?.bayesian_rating;
  const views = formatViews(detail?.total_views);
  const status = statusLabel(book);

  // infoItems is a 1- or 2-element tuple; prefer rating + views, then status.
  const candidates: InfoItem[] = [
    typeof rating === "number"
      ? { symbol: "star.fill", text: `${Math.round(rating)}%` }
      : undefined,
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
    supertitle: authors ?? descriptor(book, metadata),
    summary: detail?.description?.trim() || descriptor(book, metadata) || "",
    infoItems,
  };
}

// Latest updates card — carries the newest chapter, so it renders as a proper
// update entry with a genre subtitle and a publish date.
export function mapLatestItem(
  book: KaganeSearchBook,
  metadata: KaganeMetadata,
): DiscoverSectionItem {
  const latest = book.latest_chapters?.[0];
  if (!latest?.book_id) return mapSimpleItem(book, metadata);
  const genres = resolveGenreNames(book.genres, metadata.genres, 3).join(", ");
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: book.series_id,
    chapterId: latest.book_id,
    title: book.title.trim(),
    imageUrl: buildImageUrl(book.cover_image_id),
    contentRating: mapItemContentRating(book.content_rating),
    subtitle: genres || descriptor(book, metadata),
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
