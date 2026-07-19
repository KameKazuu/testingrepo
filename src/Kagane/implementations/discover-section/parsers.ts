/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { DiscoverSectionItem } from "@paperback/types";

import type { DetailsDto, KaganeMetadata, KaganeSearchBook, LatestChapter } from "../shared/models";
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

function detailRating(detail: DetailsDto | undefined): string | undefined {
  return starRating(detail?.average_rating ?? detail?.bayesian_rating);
}

function authorNames(detail: DetailsDto | undefined): string | undefined {
  return joinUnique(
    (detail?.series_staff ?? [])
      .filter((person) => /author|story/i.test(person.role))
      .map((person) => person.name),
  );
}

// A short "Manga • Romance, Fantasy" descriptor for a card subtitle.
function descriptor(book: KaganeSearchBook, metadata: KaganeMetadata): string | undefined {
  const bits = [
    book.format?.trim() && book.format.toLowerCase() !== "other" ? book.format : undefined,
    resolveGenreNames(book.genres, metadata.genres, 2).join(", ") || undefined,
  ].filter((bit): bit is string => Boolean(bit));
  return bits.length > 0 ? bits.join(" • ") : undefined;
}

// A star rating when available, otherwise the format/genre descriptor.
function ratingOrDescriptor(
  book: KaganeSearchBook,
  detail: DetailsDto | undefined,
  metadata: KaganeMetadata,
): string | undefined {
  return detailRating(detail) ?? descriptor(book, metadata) ?? statusLabel(book);
}

// The Popular hero: author as the supertitle, description as the summary, and a
// star rating + view count as the info chips.
export function mapFeaturedItem(
  book: KaganeSearchBook,
  detail: DetailsDto | undefined,
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

// Latest updates card — like the reference latest feed: the subtitle carries
// the star rating and the newest chapter ("★ 8.6 · Ch. 27") and the publish
// time renders as the relative date.
export function mapLatestItem(
  book: KaganeSearchBook,
  detail: DetailsDto | undefined,
  metadata: KaganeMetadata,
): DiscoverSectionItem {
  const latest = book.latest_chapters?.[0];
  if (!latest?.book_id) return mapSimpleItem(book, detail, metadata);
  const subtitle = [detailRating(detail), chapterLabel(latest)]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: book.series_id,
    chapterId: latest.book_id,
    title: book.title.trim(),
    imageUrl: buildImageUrl(book.cover_image_id),
    contentRating: mapItemContentRating(book.content_rating),
    subtitle: subtitle || undefined,
    publishDate: parseKaganeDate(latest.available_at ?? latest.created_at),
  };
}

export function mapSimpleItem(
  book: KaganeSearchBook,
  detail: DetailsDto | undefined,
  metadata: KaganeMetadata,
): DiscoverSectionItem {
  return {
    type: "simpleCarouselItem",
    mangaId: book.series_id,
    title: book.title.trim(),
    imageUrl: buildImageUrl(book.cover_image_id),
    contentRating: mapItemContentRating(book.content_rating),
    subtitle: ratingOrDescriptor(book, detail, metadata),
  };
}
