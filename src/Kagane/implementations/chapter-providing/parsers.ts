/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Chapter, SourceManga } from "@paperback/types";

import type { ChapterBook, KaganeSeriesDetailsResponse, SourceDto } from "../shared/models";
import { buildChapterTitle, parseChapterNumber, parseKaganeDate } from "../shared/utils";

// Source names (not formats) whose own chapter numbering we trust over the
// parsed chapter_no.
const SOURCE_CHAPTER_NUMBER_SOURCES = new Set([
  "Dark Horse Comics",
  "Flame Comics",
  "MangaDex",
  "Square Enix Manga",
]);

export function parseChapterList(
  data: KaganeSeriesDetailsResponse,
  sourceManga: SourceManga,
  chapterTitleMode: string,
  langCode: string,
  sources: SourceDto[],
): Chapter[] {
  const useSourceChapterNumber = shouldUseSourceChapterNumber(data, sources);
  const books = data.series_books ?? [];
  const seriesSource = data.source_id
    ? sources.find((source) => source.source_id === data.source_id)
    : undefined;
  const officialSource =
    seriesSource?.source_type.toLowerCase() === "official" ? seriesSource : undefined;

  return books.map((book, index) =>
    mapChapter(
      book,
      sourceManga,
      chapterTitleMode,
      langCode,
      useSourceChapterNumber,
      index,
      officialSource,
    ),
  );
}

function shouldUseSourceChapterNumber(
  data: KaganeSeriesDetailsResponse,
  sources: SourceDto[],
): boolean {
  const sourceName = data.source_id
    ? sources.find((source) => source.source_id === data.source_id)?.title
    : undefined;
  return Boolean(sourceName && SOURCE_CHAPTER_NUMBER_SOURCES.has(sourceName));
}

function mapChapter(
  book: ChapterBook,
  sourceManga: SourceManga,
  chapterTitleMode: string,
  langCode: string,
  useSourceChapterNumber: boolean,
  sortingIndex: number,
  officialSource: SourceDto | undefined,
): Chapter {
  const chapterNumber = parseChapterNumber(book.chapter_no);
  const volume = parseChapterNumber(book.volume_no);
  const hasVolumeOnly = volume !== undefined && chapterNumber === undefined;

  // Official uploads get a star after the platform name in the scanlator
  // slot ("Tappytoon ⭐"), so they're distinguishable from scanlation groups.
  const groupLabel =
    book.groups?.map((group) => group.title).join(", ") || officialSource?.title || undefined;
  const version = officialSource && groupLabel ? `${groupLabel} ⭐` : groupLabel;

  const chapter: Chapter = {
    chapterId: book.book_id,
    sourceManga,
    title: buildChapterTitle(book.title, book.chapter_no, book.volume_no, chapterTitleMode, [
      String(book.sort_no),
    ]),
    chapNum: hasVolumeOnly ? 0 : useSourceChapterNumber ? book.sort_no : (chapterNumber ?? 0),
    volume: volume ?? 0,
    langCode,
    version,
    publishDate: parseKaganeDate(book.created_at),
    sortingIndex,
  };

  return chapter;
}
