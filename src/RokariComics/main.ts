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

// The sidebar popular ranking's ranges (the site's Weekly / Monthly / All tabs),
// surfaced as one discover section with toggle chips like MangaDot's Top Rated.
const RANKING_RANGES = [
  { id: "weekly", title: "Weekly" },
  { id: "monthly", title: "Monthly" },
  { id: "alltime", title: "All-Time" },
] as const;

// "4 hours ago" → a Date, handling the article form ("an hour ago"). Returns
// undefined for anything unrecognized so callers can fall back gracefully.
function parseRelativeDate(text: string): Date | undefined {
  const match = text
    .toLowerCase()
    .match(/(\d+|an?)\s*(min(?:ute)?|hour|day|week|month|year)s?\s*ago/);
  if (!match) return undefined;
  const amount = /^\d/.test(match[1]) ? parseInt(match[1], 10) : 1;
  const date = new Date();
  switch (match[2]) {
    case "min":
    case "minute":
      date.setMinutes(date.getMinutes() - amount);
      break;
    case "hour":
      date.setHours(date.getHours() - amount);
      break;
    case "day":
      date.setDate(date.getDate() - amount);
      break;
    case "week":
      date.setDate(date.getDate() - amount * 7);
      break;
    case "month":
      date.setMonth(date.getMonth() - amount);
      break;
    case "year":
      date.setFullYear(date.getFullYear() - amount);
      break;
  }
  return date;
}

// A chapter label ("Chapter 42", "Chapter 10.5") → the chapter id this theme's
// chapter list uses (the data-num value: the number itself, spaces dashed).
// Paperback rejects ids containing spaces — passing the raw label as an id is
// what crashed the Recommendation section — and only [\w.-] survive here so a
// decorated label can never produce an invalid id.
function chapterIdFromLabel(label: string): string {
  return label
    .trim()
    .replace(/^chapter\s*/i, "")
    .replace(/\s+/g, "-")
    .replace(/[^\w.-]/g, "");
}

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
    // synopsis and "Start Reading" on the site). Items are parsed by
    // parseFeatured with the slide's synopsis + latest-chapter pill.
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

    // Latest Update — the homepage update grid, parsed by parseLatest into
    // chapter-update rows with a real (numeric) chapter id and, when the grid
    // carries one, the "4 hours ago" upload time.
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

    // Recommendation — the genre-tabbed block near the bottom, flattened into a
    // plain cover carousel. Simple cards on purpose: the grid links to series
    // (not chapters), and building chapter-update rows from it passed the
    // display label ("Chapter 10") as a chapter id, which Paperback rejects —
    // the "Invalid ID" error this section used to show.
    const recommendation: MangaStreamDiscoverSection = {
      id: "recommendation",
      title: "Recommendation",
      type: DiscoverSectionType.simpleCarousel,
      selectorFunc: ($: CheerioAPI) => $("div.series-gen div.listupd div.bsx"),
      titleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("a", element).attr("title") ?? $("div.tt", element).first().text().trim(),
      subtitleSelectorFunc: ($: CheerioAPI, element: BasicAcceptedElems<AnyNode>) =>
        $("div.epxs", element).first().text().trim(),
      itemType: "simpleCarouselItem",
      enabled: true,
    };

    // Popular — the sidebar Weekly / Monthly / All-time ranking as ONE section
    // with toggle chips (MangaDot's Top Rated pattern) instead of three
    // separate carousels. A chip tap routes through getSearchResults, which
    // parses the corresponding pre-rendered sidebar list.
    const popularRanking: MangaStreamDiscoverSection = {
      id: "popular_ranking",
      title: "Popular",
      type: DiscoverSectionType.genres,
      selectorFunc: ($: CheerioAPI) => $(),
      titleSelectorFunc: () => "",
      subtitleSelectorFunc: () => "",
      itemType: "genresCarouselItem",
      enabled: true,
    };

    this.discoverSections = [hero, popularToday, latest, recommendation, popularRanking];
  }

  override async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: MangaStreamSearchMetadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    // The ranking chips are static — no homepage fetch needed.
    if (section.id === "popular_ranking") {
      return {
        items: RANKING_RANGES.map((range) => ({
          type: "genresCarouselItem",
          name: range.title,
          searchQuery: {
            title: "",
            metadata: { rokariRange: range.id },
          },
        })),
      };
    }

    const [_response, buffer] = await Application.scheduleRequest({
      url: this.domain,
      method: "GET",
    });
    const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));

    switch (section.id) {
      case "featured":
        return { items: await this.parseFeatured($), metadata };
      case "latest_updates":
        return { items: await this.parseLatest($), metadata };
      case "recommendation":
        return { items: await this.parseRecommendation($), metadata };
      default: {
        const configured =
          this.discoverSections.find((x) => x.id === section.id) ?? this.latestUpdatesSection;
        return { items: await this.parser.parseHomeSection($, configured, this), metadata };
      }
    }
  }

  // Series id from an anchor href (slug, or the post id when that setting is
  // on), shared by every custom homepage parser here.
  private async resolveMangaId(href: string, relAttr?: string): Promise<string> {
    const slug = href.replace(/\/$/, "").split("/").pop() ?? "";
    if (!getUsePostIds()) return slug;
    const path = href.replace(/\/$/, "").split("/").slice(-2).shift() ?? "";
    return relAttr && !isNaN(Number(relAttr)) ? relAttr : await this.slugToPostId(slug, path);
  }

  // Hero slider → featured cards with the slide's synopsis and latest-chapter
  // pill, like the Mangago/MangaDot featured rails. Selector lists are ordered
  // most-specific-first and every field degrades to empty rather than dropping
  // the slide.
  private async parseFeatured($: CheerioAPI): Promise<DiscoverSectionItem[]> {
    const items: DiscoverSectionItem[] = [];
    for (const slide of $("div.slider-wrapper div.swiper-slide").toArray()) {
      const anchor = $("a", slide).first();
      const href = anchor.attr("href") ?? "";
      const title = $("span.name", slide).first().text().trim();
      if (!href || !title) continue;

      const mangaId = await this.resolveMangaId(href, anchor.attr("rel"));
      if (!mangaId) continue;

      const imageUrl = this.parser.getImageSrc($("img", slide)) ?? "";
      if (!imageUrl) continue;

      // The slide's synopsis block; collapse whitespace and cap the length so a
      // full-length description can't overflow the hero card.
      const summary = $("div.desc, div.summary, div.excerpt, p", slide)
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280);

      // The slide's latest-chapter label, wherever this skin puts it.
      const chapterLabel = (
        $("span.chapter, div.chapter, span.epxs, div.epxs, a[href*='chapter']", slide)
          .first()
          .text() ||
        ($(slide)
          .text()
          .match(/Chapter\s*[\d.]+/i)?.[0] ??
          "")
      )
        .replace(/\s+/g, " ")
        .trim();

      items.push({
        type: "featuredCarouselItem",
        mangaId,
        imageUrl,
        title,
        summary: summary || undefined,
        infoItems: chapterLabel ? [{ symbol: "book.fill", text: chapterLabel }] : undefined,
      });
    }
    return items;
  }

  // Latest Update grid → chapter-update rows. The chapter id is the numeric
  // part of the label (this theme's chapter list uses the number as the id, so
  // taps deep-link correctly), never the raw display text — Paperback rejects
  // ids with spaces. The subtitle prefers the upload time ("4 hours ago") when
  // the grid carries one, falling back to the chapter label; the parsed time
  // also fills publishDate.
  private async parseLatest($: CheerioAPI): Promise<DiscoverSectionItem[]> {
    const items: DiscoverSectionItem[] = [];
    for (const element of $(".bixbox:has(h2:contains(Latest)) .bs .bsx").toArray()) {
      const anchor = $("a", element).first();
      const href = anchor.attr("href") ?? "";
      const title = anchor.attr("title") ?? $("div.tt", element).first().text().trim();
      if (!href || !title) continue;

      const mangaId = await this.resolveMangaId(href, anchor.attr("rel"));
      if (!mangaId) continue;

      const imageUrl = this.parser.getImageSrc($("img", element)) ?? "";
      const chapterLabel = $("div.epxs", element).first().text().replace(/\s+/g, " ").trim();
      const chapterId = chapterIdFromLabel(chapterLabel);

      const timeText = $("div.epxdate, span.datech, div.datech, time", element)
        .first()
        .text()
        .replace(/\s+/g, " ")
        .trim();
      const publishDate = timeText ? parseRelativeDate(timeText) : undefined;

      if (chapterId) {
        items.push({
          type: "chapterUpdatesCarouselItem",
          mangaId,
          chapterId,
          imageUrl,
          title,
          subtitle: timeText || chapterLabel || undefined,
          publishDate,
        });
      } else {
        // No usable chapter number — a plain card beats an invalid id.
        items.push({
          type: "simpleCarouselItem",
          mangaId,
          imageUrl,
          title,
          subtitle: chapterLabel || undefined,
        });
      }
    }
    return items;
  }

  // Recommendation grid → simple cover cards (series links + chapter label).
  private async parseRecommendation($: CheerioAPI): Promise<DiscoverSectionItem[]> {
    const items: DiscoverSectionItem[] = [];
    for (const element of $("div.series-gen div.listupd div.bsx").toArray()) {
      const anchor = $("a", element).first();
      const href = anchor.attr("href") ?? "";
      const title = anchor.attr("title") ?? $("div.tt", element).first().text().trim();
      if (!href || !title) continue;

      const mangaId = await this.resolveMangaId(href, anchor.attr("rel"));
      if (!mangaId) continue;

      const imageUrl = this.parser.getImageSrc($("img", element)) ?? "";
      const subtitle = $("div.epxs", element).first().text().replace(/\s+/g, " ").trim();

      items.push({
        type: "simpleCarouselItem",
        mangaId,
        imageUrl,
        title,
        subtitle: subtitle || undefined,
      });
    }
    return items;
  }

  // Sidebar "Popular" ranking list (Weekly / Monthly / All-time). Each `<li>`
  // carries the slug/post id on `a.series` and the display title in
  // `.leftseries`; the homepage-grid parser can't read this shape.
  private async parseRankingList($: CheerioAPI, range: string): Promise<SearchResultItem[]> {
    const items: SearchResultItem[] = [];
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

      const mangaId = await this.resolveMangaId(href, anchor.attr("rel"));
      if (!mangaId) continue;

      items.push({ mangaId, imageUrl, title, subtitle });
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
    // A Popular chip tap: parse the matching pre-rendered sidebar ranking. This
    // must run before the filter loop below — the chip metadata is an object,
    // not the filter array the normal search path iterates.
    const rawMetadata = query.metadata as unknown;
    if (rawMetadata && !Array.isArray(rawMetadata) && typeof rawMetadata === "object") {
      const range = (rawMetadata as { rokariRange?: string }).rokariRange;
      if (range && RANKING_RANGES.some((r) => r.id === range)) {
        const [_response, buffer] = await Application.scheduleRequest({
          url: this.domain,
          method: "GET",
        });
        const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
        return { items: await this.parseRankingList($, range) };
      }
    }

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
