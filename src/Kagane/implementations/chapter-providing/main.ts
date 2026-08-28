/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Chapter, ChapterDetails, SourceManga } from "@paperback/types";
import { URL } from "@paperback/types";

import {
  apiHeaders,
  fetchJSON,
  getChallengeResponse,
  getKaganeMetadata,
} from "../../services/network";
import { getChapterTitleMode, getContentLanguages, getDataSaver } from "../settings-form/main";
import {
  API_URL,
  DEFAULT_CACHE_URL,
  type KaganeSeriesDetailsResponse,
  type SourceDto,
} from "../shared/models";
import { buildPageUrl } from "../shared/utils";
import { parseChapterList } from "./parsers";

export class ChapterProvider {
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const data = await fetchJSON<KaganeSeriesDetailsResponse>({
      url: seriesUrl(sourceManga.mangaId),
      method: "GET",
      headers: apiHeaders(),
    });
    const sources = await safeSources();
    // Prefer the series' own translated language over the reader's first
    // language preference so chapters are tagged with what they actually are.
    const langCode = data.translated_language ?? getContentLanguages()[0] ?? "en";

    return parseChapterList(data, sourceManga, getChapterTitleMode(), langCode, sources);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterId = chapter.chapterId;
    const challenge = await getChallengeResponse(chapterId);
    const cacheUrl = challenge.cache_url || DEFAULT_CACHE_URL;

    const manifestPages = challenge.manifest?.pages ?? [];
    if (manifestPages.length === 0) {
      throw new Error(`No pages returned for chapter ${chapterId}`);
    }

    // Paperback's reader preloads upcoming pages itself, so we just hand back
    // the full ordered list of page URLs.
    const dataSaver = getDataSaver();
    const pages = [...manifestPages]
      .sort((left, right) => left.page_no - right.page_no)
      .map((page) =>
        buildPageUrl(
          cacheUrl,
          chapterId,
          `${page.page_id}.${page.ext ?? "jxl"}`,
          challenge.access_token,
          dataSaver,
        ),
      );

    return {
      id: chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }
}

function seriesUrl(seriesId: string): string {
  return new URL(API_URL)
    .addPathComponent("api")
    .addPathComponent("v2")
    .addPathComponent("series")
    .addPathComponent(seriesId)
    .toString();
}

async function safeSources(): Promise<SourceDto[]> {
  try {
    return (await getKaganeMetadata()).sources;
  } catch {
    return [];
  }
}
