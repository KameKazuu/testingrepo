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
import { API_URL, DEFAULT_CACHE_URL, type DetailsDto, type SourceDto } from "../shared/models";
import { parseChapterList } from "./parsers";

export class ChapterProvider {
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const data = await fetchJSON<DetailsDto>({
      url: seriesUrl(sourceManga.mangaId),
      method: "GET",
      headers: apiHeaders(),
    });
    const sources = await safeSources();
    const langCode = getContentLanguages()[0] ?? "en";

    return parseChapterList(data, sourceManga, getChapterTitleMode(), langCode, sources);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterId = chapter.chapterId;
    const challenge = await getChallengeResponse(chapterId);
    const dataSaver = getDataSaver();
    const cacheUrl = challenge.cache_url || DEFAULT_CACHE_URL;

    const pages = [...(challenge.manifest?.pages ?? [])]
      .sort((left, right) => left.page_no - right.page_no)
      .map((page) => {
        return new URL(cacheUrl)
          .addPathComponent("api")
          .addPathComponent("v2")
          .addPathComponent("books")
          .addPathComponent("page")
          .addPathComponent(chapterId)
          .addPathComponent(`${page.page_id}.${page.ext ?? "jxl"}`)
          .setQueryItem("token", challenge.access_token)
          .setQueryItem("is_datasaver", String(dataSaver))
          .toString();
      });

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
