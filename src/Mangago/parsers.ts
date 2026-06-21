import {
  ContentRating,
  type Chapter,
  type MangaInfo,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { DOMAIN } from "./models";
import { absoluteUrl, extractMangaId } from "./utils";

export function parseListings(html: string): SearchResultItem[] {
  const $ = cheerio.load(html);
  const items: SearchResultItem[] = [];

  $(".updatesli, .pic_list > li").each((_, element) => {
    const $el = $(element);
    const $link = $el.find(".thm-effect").first();

    const href = $link.attr("href") ?? "";
    const mangaId = extractMangaId(href);

    const title = ($link.attr("title") ?? "").trim();
    if (!mangaId || !title) return;

    const $img = $link.find("img").first();
    const imageUrl = absoluteUrl($img.attr("data-src") || $img.attr("src") || "");

    items.push({
      mangaId,
      title,
      imageUrl,
    });
  });

  return items;
}

export function hasNextPage(html: string): boolean {
  const $ = cheerio.load(html);
  return $(".current + li > a").length > 0;
}

export function mangaUrlFromId(mangaId: string): string {
  if (mangaId.startsWith("http")) return mangaId;
  return `${DOMAIN}${mangaId}`;
}

export function chapterUrlFromId(chapterId: string): string {
  if (chapterId.startsWith("http")) return chapterId;
  return `${DOMAIN}${chapterId}`;
}

export function parseMangaDetails(html: string, mangaId: string): SourceManga {
  const $ = cheerio.load(html);

  const info = $("#information");

  const title = $(".w-title h1").first().text().trim() || mangaId;
  const imageUrl = absoluteUrl(info.find("img").first().attr("src") ?? "");

  const summary = info.find(".manga_summary").first();
  summary.find("font").remove();

  const description = summary.text().trim();

  let status: MangaInfo["status"] = "UNKNOWN";
  let author = "";
  const tags: Tag[] = [];
  const tagTitles: string[] = [];

  info.find(".manga_info li, .manga_right tr").each((_, element) => {
    const $el = $(element);
    const label = $el.find("b, label").first().text().trim().toLowerCase();

    if (label === "status:") {
      const value = $el.find("span").first().text().trim().toLowerCase();

      if (value === "ongoing") status = "ONGOING";
      else if (value === "completed") status = "COMPLETED";
    }

    if (label === "author(s):" || label === "author:") {
      author = $el
        .find("a")
        .map((_, a) => $(a).text().trim())
        .get()
        .join(", ");
    }

    if (label === "genre(s):") {
      $el.find("a").each((_, a) => {
        const genreTitle = $(a).text().trim();
        const href = $(a).attr("href") ?? "";
        const id = href.match(/\/genre\/([^/?]+)/)?.[1] ?? genreTitle.toLowerCase();

        if (genreTitle) {
          tagTitles.push(genreTitle);
          tags.push({ id, title: genreTitle });
        }
      });
    }
  });

  const isAdult = tagTitles.some((x) => ["Adult", "Smut", "Yaoi"].includes(x));
  const isMature = tagTitles.some((x) => x === "Ecchi");

  return {
    mangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles: [],
      thumbnailUrl: imageUrl,
      synopsis: description,
      author,
      status,
      contentRating: isAdult
        ? ContentRating.ADULT
        : isMature
          ? ContentRating.MATURE
          : ContentRating.EVERYONE,
      tagGroups: [
        {
          id: "genres",
          title: "Genres",
          tags,
        },
      ],
    },
  };
}

function parseChapterTitle(input: string): {
  volume?: number;
  chapter?: number;
  title?: string;
} {
  const trimmed = input.trim();
  const colon = trimmed.indexOf(":");

  let left = colon >= 0 ? trimmed.slice(0, colon).trim() : trimmed;
  const right = colon >= 0 ? trimmed.slice(colon + 1).trim() : "";

  let volume: number | undefined;
  let chapter: number | undefined;
  let title: string | undefined;

  if (left.startsWith("Vol.")) {
    left = left.slice(4).trimStart();
    const m = /^(\d+(?:\.\d+)?)/.exec(left);
    if (m) {
      volume = Number(m[1]);
      left = left.slice(m[1]!.length).trimStart();
    }
  }

  if (left.startsWith("Ch.")) {
    left = left.slice(3).trimStart();
    const m = /^(\d+(?:\.\d+)?)/.exec(left);
    if (m) {
      chapter = Number(m[1]);
      left = left.slice(m[1]!.length).trimStart();
    }
  }

  if (right) title = right;
  else if (left) title = left;

  return { volume, chapter, title };
}

export function parseChapters(html: string, sourceManga: SourceManga): Chapter[] {
  const $ = cheerio.load(html);
  const chapters: Chapter[] = [];

  $("table#chapter_table > tbody > tr, table.uk-table > tbody > tr").each((index, element) => {
    const $row = $(element);
    const $link = $row.find("a.chico").first();

    const href = $link.attr("href") ?? "";
    if (!href) return;

    const chapterId = extractMangaId(href);
    const rawTitle = $link.text().trim();
    const parsed = parseChapterTitle(rawTitle);

    const dateText = $row.find("td").last().text().trim();
    const publishDate = dateText ? new Date(dateText) : undefined;

    chapters.push({
      chapterId,
      sourceManga,
      title: parsed.title || rawTitle,
      chapNum: parsed.chapter ?? chapters.length + 1,
      volume: parsed.volume,
      publishDate,
      langCode: "en",
      sortingIndex: index,
    });
  });

  return chapters;
}
