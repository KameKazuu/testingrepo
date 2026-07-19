/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Request, SourceManga } from "@paperback/types";
import { URL } from "@paperback/types";

import { apiHeaders, fetchJSON, getKaganeMetadata } from "../../services/network";
import { getContentRatingSetting, getShowEdition, getShowSource } from "../settings-form/main";
import { API_URL, type DetailsDto, type KaganeMetadata } from "../shared/models";
import { parseMangaDetails } from "./parsers";

export class MangaProvider {
  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const request: Request = {
      url: new URL(API_URL)
        .addPathComponent("api")
        .addPathComponent("v2")
        .addPathComponent("series")
        .addPathComponent(mangaId)
        .toString(),
      method: "GET",
      headers: apiHeaders(),
    };

    const [data, metadata] = await Promise.all([fetchJSON<DetailsDto>(request), safeMetadata()]);

    return parseMangaDetails(mangaId, data, metadata, {
      showEdition: getShowEdition(),
      showSource: getShowSource(),
      contentRating: getContentRatingSetting(),
    });
  }
}

async function safeMetadata(): Promise<KaganeMetadata | undefined> {
  try {
    return await getKaganeMetadata();
  } catch {
    return undefined;
  }
}
