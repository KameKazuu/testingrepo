/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Chapter, ChapterDetails, Request, SourceManga } from "@paperback/types";
import { URL } from "@paperback/types";

import { fetchJSON } from "../../services/network";
import { DOMAIN_API } from "../shared/models";
import type { HiveScansChapterResponse, HiveScansPostDetailsResponse } from "../shared/models";
import { decodeMangaId } from "../shared/utils";
import { parseChapterDetails, parseChapterList } from "./parsers";

export class ChapterProvider {
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const slug = decodeMangaId(sourceManga.mangaId);
    const url = new URL(DOMAIN_API)
      .addPathComponent("post")
      .setQueryItem("postSlug", slug)
      .toString();

    const request: Request = { url, method: "GET" };
    const data = await fetchJSON<HiveScansPostDetailsResponse>(request);

    return parseChapterList(data.post.chapters ?? [], sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = new URL(DOMAIN_API)
      .addPathComponent("chapter")
      .setQueryItem("chapterId", chapter.chapterId)
      .toString();

    const request: Request = { url, method: "GET" };
    const data = await fetchJSON<HiveScansChapterResponse>(request);

    if (!data.chapter) {
      throw new Error(`No chapter data returned for chapter ${chapter.chapterId}`);
    }

    return parseChapterDetails(data.chapter, chapter);
  }
}
