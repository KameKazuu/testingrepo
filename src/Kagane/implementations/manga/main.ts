/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Request, SourceManga } from "@paperback/types";
import { URL } from "@paperback/types";

import { apiHeaders, fetchJSON, getKaganeMetadata } from "../../services/network";
import { getShowEdition, getShowSource, getShowSpoilerTags } from "../settings-form/main";
import { API_URL, type KaganeSeriesDetailsResponse, type KaganeMetadata } from "../shared/models";
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

    // Sequential (metadata is cached after the first discover load) so a cold
    // open doesn't fire two challengeable requests at once.
    const metadata = await safeMetadata();
    const data = await fetchJSON<KaganeSeriesDetailsResponse>(request);

    return parseMangaDetails(mangaId, data, metadata, {
      showEdition: getShowEdition(),
      showSource: getShowSource(),
      showSpoilerTags: getShowSpoilerTags(),
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
