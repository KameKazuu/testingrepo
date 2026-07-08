/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  DiscoverSectionType,
  URL,
  type ContentRating,
  type DiscoverSection,
  type DiscoverSectionItem,
  type Form,
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
import { type MangaStreamDiscoverSection, type MangaStreamSearchMetadata } from "../generic/models";
import { getFilterTagsBySection, getIncludedTagBySection } from "../generic/utils";
import pbconfig from "./pbconfig";
import { getBaseUrlOverride, RokariComicsSettings } from "./settings";

const DOMAIN_NAME = "https://rokaricomics.com";

class RokariComicsExtension extends MangaStreamGeneric {
  name = pbconfig.name;
  contentRating: ContentRating = pbconfig.contentRating;

  // Read the domain live so the "Base URL" override takes effect immediately.
  get domain(): string {
    return getBaseUrlOverride() ?? DOMAIN_NAME;
  }

  override async getSettingsForm(): Promise<Form> {
    return new RokariComicsSettings(this.name, DOMAIN_NAME);
  }

  override configureSections() {
    // Featured — the big top hero slider (the spotlight banner with the cover,
    // synopsis and "Start Reading" on the site). Render it as a featured banner
    // like the other Inkdex sources, not a plain grid.
    const hero: MangaStreamDiscoverSection = {
      id: "featured",
      title: "Featured",
      type: DiscoverSectionType.featured,
      selectorFunc: ($: CheerioAPI) => $("div.slider-wrapper div.swiper-slide"),
      titleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("span.name", element).first().text().trim(),
      subtitleSelectorFunc: () => "",
      itemType: "featuredCarouselItem",
      enabled: true,
    };

    // Popular Today — the horizontal cover carousel under the hero.
    const popularToday: MangaStreamDiscoverSection = {
      id: "popular",
      title: "Popular Today",
      type: DiscoverSectionType.prominentCarousel,
      selectorFunc: ($: CheerioAPI) => $("div.popularslider div.bsx"),
      titleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("a", element).attr("title") ?? $("div.tt", element).first().text().trim(),
      subtitleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("div.epxs", element).first().text().trim(),
      itemType: "prominentCarouselItem",
      enabled: true,
    };

    // Latest Update — the homepage update grid; carry the newest chapter label.
    const latest: MangaStreamDiscoverSection = {
      id: "latest_updates",
      title: "Latest Updates",
      type: DiscoverSectionType.chapterUpdates,
      selectorFunc: ($: CheerioAPI) => $(".bixbox:has(h2:contains(Latest)) .bs .bsx"),
      titleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("a", element).attr("title") ?? $("div.tt", element).first().text().trim(),
      subtitleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("div.epxs", element).first().text().trim(),
      itemType: "chapterUpdatesCarouselItem",
      enabled: true,
    };

    // Recommendation — the genre-tabbed block near the bottom. Paperback has no
    // in-section tabs, so flatten every genre tab into one carousel (the site
    // randomises which tabs appear per load anyway).
    const recommendation: MangaStreamDiscoverSection = {
      id: "recommendation",
      title: "Recommendation",
      type: DiscoverSectionType.chapterUpdates,
      selectorFunc: ($: CheerioAPI) => $("div.series-gen div.listupd div.bsx"),
      titleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("a", element).attr("title") ?? $("div.tt", element).first().text().trim(),
      subtitleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("div.epxs", element).first().text().trim(),
      itemType: "chapterUpdatesCarouselItem",
      enabled: true,
    };

    // Popular ranking widget — the sidebar exposes Weekly / Monthly / All-time
    // tabs, all pre-rendered in the homepage HTML. Discover has no inline
    // toggle, so surface each range as its own carousel.
    const ranking = (range: string, title: string): MangaStreamDiscoverSection => ({
      id: `popular_${range}`,
      title,
      type: DiscoverSectionType.prominentCarousel,
      selectorFunc: ($: CheerioAPI) => $(`div.serieslist.pop.wpop-${range} li`),
      titleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("div.leftseries h2 a", element).first().text().trim(),
      subtitleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("div.leftseries span", element)
          .first()
          .text()
          .replace(/^\s*Genres:\s*/i, "")
          .trim(),
      itemType: "prominentCarouselItem",
      enabled: true,
    });

    this.discoverSections = [
      hero,
      popularToday,
      latest,
      recommendation,
      ranking("weekly", "Popular Weekly"),
      ranking("monthly", "Popular Monthly"),
      ranking("alltime", "Popular All-Time"),
    ];
  }

  override async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: MangaStreamSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const [_response, buffer] = await Application.scheduleRequest({
      url: this.domain,
      method: "GET",
    });
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    // The sidebar ranking widget uses its own list markup (not the homepage
    // grid), so parse it directly into prominent cards.
    const rankingMatch = section.id.match(/^popular_(weekly|monthly|alltime)$/);
    if (rankingMatch?.[1]) {
      return { items: await this.parseRankingList($, rankingMatch[1]), metadata };
    }

    const configured =
      this.discoverSections.find((x) => x.id === section.id) ?? this.latestUpdatesSection;
    return { items: await this.parser.parseHomeSection($, configured, this), metadata };
  }

  // Sidebar "Popular" ranking list (Weekly / Monthly / All-time). Each `<li>`
  // carries the slug/post id on `a.series` and the display title in
  // `.leftseries`; the homepage-grid parser can't read this shape.
  private async parseRankingList($: CheerioAPI, range: string): Promise<DiscoverSectionItem[]> {
    const items: DiscoverSectionItem[] = [];
    for (const li of $(`div.serieslist.pop.wpop-${range} li`).toArray()) {
      const anchor = $("a.series", li).first();
      const href = anchor.attr("href") ?? "";
      const title =
        $("div.leftseries h2 a", li).first().text().trim() || anchor.attr("title") || "";
      if (!href || !title) continue;

      const imageUrl = this.parser.getImageSrc($("img", li)) ?? "";
      const subtitle = $("div.leftseries span", li)
        .first()
        .text()
        .replace(/^\s*Genres:\s*/i, "")
        .trim();

      const slug = href.replace(/\/$/, "").split("/").pop() ?? "";
      const postId = anchor.attr("rel") ?? "";
      let mangaId = slug;
      if (getUsePostIds()) {
        const path = href.replace(/\/$/, "").split("/").slice(-2).shift() ?? "";
        mangaId = postId && !isNaN(Number(postId)) ? postId : await this.slugToPostId(slug, path);
      }
      if (!mangaId) continue;

      items.push({ type: "prominentCarouselItem", mangaId, imageUrl, title, subtitle });
    }
    return items;
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
