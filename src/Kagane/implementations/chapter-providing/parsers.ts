/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Chapter, SourceManga } from "@paperback/types";

import type { ChapterBook, ChapterIndexDto, KaganeSeriesDetailsResponse, SourceDto } from "../shared/models";
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

export function parseChapterIndex(index: ChapterIndexDto): ChapterBook[] {
  if (!Array.isArray(index.fields) || !Array.isArray(index.books)) {
    throw new Error("Kagane chapter index has an invalid shape.");
  }
  const column = (name: string): number => index.fields.indexOf(name);
  const idColumn = column("book_id");
  const sortColumn = column("sort_no");
  if (idColumn < 0 || sortColumn < 0) {
    throw new Error("Kagane chapter index is missing required columns.");
  }
  if (Number.isSafeInteger(index.count) && index.count !== index.books.length) {
    throw new Error("Kagane chapter index returned an incomplete list.");
  }

  const seen = new Set<string>();
  const books = index.books.map((row): ChapterBook => {
    if (!Array.isArray(row)) throw new Error("Kagane chapter index contains an invalid row.");
    const id = row[idColumn];
    const sort = row[sortColumn];
    if (typeof id !== "string" || !id || seen.has(id)) {
      throw new Error("Kagane chapter index contains an invalid or duplicate book ID.");
    }
    if (typeof sort !== "number" || !Number.isFinite(sort)) {
      throw new Error("Kagane chapter index contains an invalid sort number.");
    }
    seen.add(id);
    const cell = (name: string): unknown => row[column(name)];
    const toText = (value: unknown): string | undefined =>
      typeof value === "string" || typeof value === "number" ? String(value) : undefined;
    const timestamp = cell("released_at");
    const date =
      typeof timestamp === "number" && Number.isFinite(timestamp)
        ? new Date(timestamp > 100_000_000_000 ? timestamp : timestamp * 1000).toISOString()
        : typeof timestamp === "string"
          ? timestamp
          : undefined;
    const groupIndices = cell("group_ix");
    const groups = Array.isArray(groupIndices)
      ? groupIndices
          .filter((value): value is number => Number.isInteger(value))
          .map((value) => index.groups?.[value])
          .filter((group): group is { title: string } => typeof group?.title === "string")
      : [];

    return {
      book_id: id,
      sort_no: sort,
      title: toText(cell("title")) ?? "",
      chapter_no: toText(cell("chapter_no")),
      volume_no: toText(cell("volume_no")),
      created_at: date,
      groups,
    };
  });
  return books.sort((left, right) => right.sort_no - left.sort_no);
}
