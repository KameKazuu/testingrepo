/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  URL,
  type ContentRating,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
} from "@paperback/types";
import { type SearchFilterValue } from "@paperback/types/lib/compat/0.8";
import * as cheerio from "cheerio";
import { type BasicAcceptedElems, type CheerioAPI } from "cheerio";
import { type AnyNode } from "domhandler";

import { getUsePostIds } from "../generic/forms";
import { MangaStreamGeneric } from "../generic/main";
import { type MangaStreamSearchMetadata } from "../generic/models";
import { getFilterTagsBySection, getIncludedTagBySection } from "../generic/utils";
import pbconfig from "./pbconfig";

const DOMAIN_NAME = "https://rokaricomics.com";

class RokariComicsExtension extends MangaStreamGeneric {
  domain = DOMAIN_NAME;
  name = pbconfig.name;
  contentRating: ContentRating = pbconfig.contentRating;

  override configureSections() {
    // Popular Today hero — the first homepage grid.
    this.featuredSection.selectorFunc = ($: CheerioAPI) =>
      $(".bixbox:has(h2:contains(Popular)) .bs .bsx");

    // Latest Update — the second homepage grid; carry the newest chapter label.
    this.latestUpdatesSection.selectorFunc = ($: CheerioAPI) =>
      $(".bixbox:has(h2:contains(Latest)) .bs .bsx");
    this.latestUpdatesSection.subtitleSelectorFunc = (
      $: CheerioAPI,
      element: BasicAcceptedElems<AnyNode>,
    ) => $("div.epxs", element).first().text().trim();
  }

  // The site serves search + filtering from the site-root `/?s=` page (the
  // `/manga/` archive no longer answers taxonomy queries), so build the query
  // there and pass every filter through together.
  override async getSearchResults(
    query: SearchQuery<SearchFilterValue[]>,
    metadata: MangaStreamSearchMetadata | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;

    const includedTags: string[] = [];
    for (const filter of query?.metadata ?? []) {
      const tags = (filter.value ?? {}) as Record<string, "included" | "excluded">;
      for (const id of Object.keys(tags)) {
        includedTags.push(id);
      }
    }

    const urlBuilder = new URL(this.domain)
      .setQueryItem("s", encodeURIComponent((query.title ?? "").replace(/[’–][a-z]*/g, "")))
      .setQueryItem("page", page.toString());

    const status = getIncludedTagBySection("status", includedTags);
    const type = getIncludedTagBySection("type", includedTags);
    const order = getIncludedTagBySection("order", includedTags);
    if (status) urlBuilder.setQueryItem("status", status);
    if (type) urlBuilder.setQueryItem("type", type);
    if (order) urlBuilder.setQueryItem("order", order);

    const genres = getFilterTagsBySection("genres", includedTags, true);
    if (genres.length > 0) urlBuilder.setQueryItem("genre[]", genres);

    const [_response, buffer] = await Application.scheduleRequest({
      url: urlBuilder.toString(),
      method: "GET",
    });
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
    const results = this.parser.parseSearchResults($);

    const manga: SearchResultItem[] = [];
    for (const result of results) {
      let mangaId: string = result.mangaId;
      if (getUsePostIds()) {
        mangaId = await this.slugToPostId(result.mangaId, result.path);
      }
      manga.push({
        mangaId,
        title: result.title,
        subtitle: result.subtitle,
        imageUrl: result.imageUrl,
      });
    }

    const hasNextPage = $("div.hpage .r, div.pagination .next, a.next.page-numbers").length > 0;
    return { items: manga, metadata: hasNextPage ? { page: page + 1 } : undefined };
  }
}

export const RokariComics = new RokariComicsExtension();
