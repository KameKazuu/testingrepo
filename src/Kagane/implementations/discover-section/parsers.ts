/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { DiscoverSectionItem } from "@paperback/types";

import type { KaganeSearchBook, SourceDto } from "../shared/models";
import { buildImageUrl } from "../shared/utils";

export function mapDiscoverItem(
  book: KaganeSearchBook,
  sources: SourceDto[],
  showSource: boolean,
  contentRating: DiscoverSectionItem["contentRating"],
): DiscoverSectionItem {
  const sourceName = book.source_id
    ? sources.find((source) => source.source_id === book.source_id)?.title
    : undefined;

  return {
    type: "simpleCarouselItem",
    mangaId: book.series_id,
    title: showSource && sourceName ? `${book.title.trim()} [${sourceName}]` : book.title.trim(),
    imageUrl: buildImageUrl(book.cover_image_id),
    subtitle: typeof book.current_books === "number" ? `${book.current_books} Books` : undefined,
    contentRating,
  };
}
