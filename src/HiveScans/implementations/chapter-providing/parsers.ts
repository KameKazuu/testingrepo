/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Chapter, ChapterDetails, SourceManga } from "@paperback/types";

import type { HiveScansChapter, HiveScansPage } from "../shared/models";

export function parseChapterList(
  chapters: HiveScansChapter[],
  sourceManga: SourceManga,
): Chapter[] {
  const available = chapters.filter(
    (chapter) => chapter.chapterStatus === "PUBLIC" && chapter.isAccessible,
  );

  const sorted = [...available].sort((a, b) => {
    const aNum = typeof a.number === "number" ? a.number : parseFloat(String(a.number)) || 0;
    const bNum = typeof b.number === "number" ? b.number : parseFloat(String(b.number)) || 0;
    return aNum - bNum;
  });

  return sorted.map((chapter, index) => {
    const chapNum =
      typeof chapter.number === "number" ? chapter.number : parseFloat(String(chapter.number)) || 0;

    return {
      chapterId: chapter.id.toString(),
      sourceManga,
      title: chapter.title?.trim() || "",
      chapNum,
      volume: 0,
      langCode: "en",
      sortingIndex: index,
      publishDate: new Date(chapter.createdAt),
    };
  });
}

export function parseChapterDetails(data: HiveScansPage, chapter: Chapter): ChapterDetails {
  if (data.isShortLinkLocked) throw new Error("Chapter locked (short link)");
  if (data.isLockedByCoins) throw new Error("Chapter locked (coins required)");
  if (data.isPermanentlyLocked) throw new Error("Chapter permanently locked");

  const pages = [...(data.images ?? [])]
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
    .map((image) => image.url.replace(/ /g, "%20"))
    .filter((url) => url.length > 0);

  if (pages.length === 0) {
    throw new Error("No chapter page data could be parsed from HiveScans for this chapter.");
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
}
