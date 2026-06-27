import {
  ContentRating,
  type Chapter,
  type MangaInfo,
  type SearchResultItem,
  type SourceManga,
  type Tag,
} from "@paperback/types";
import * as cheerio from "cheerio";

import { DOMAIN, READER_DOMAIN } from "./models";
import { absoluteUrl, extractMangaId } from "./utils";

const KNOWN_GROUPS = [
  {
    title: "Official",
    patterns: [/official/i],
  },
  {
    title: "Asura Scans",
    patterns: [/asura scans/i, /\basura\b/i],
  },
  {
    title: "Reaper Scans",
    patterns: [/reaper scans/i, /\breaper\b/i],
  },
  {
    title: "Speedcat",
    patterns: [/speedcat/i],
  },
  {
    title: "Death by Roses",
    patterns: [/death by roses/i],
  },
  {
    title: "Bored Corona Kids",
    patterns: [/bored corona kids/i],
  },
];

const OFFICIAL_UPLOADERS = new Set(
  [
    "Akumakira",
    "Jujucat",
    "Abijyn",
    "Jihoonx",
    "Lemonade",
    "Tortureritual",
    "Inori008",
    "Icarus",
    "laura",
    "Kanbe daiSUKE",
    "nanachi",
    "bloomingdale",
    "nekobasu",
    "attackonlevisass",
    "Leah",
    "areum",
    "Soo",
    "sera",
    "Lynn",
  ].map((uploader) => uploader.replace(/\s+/g, " ").trim().toLowerCase()),
);

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function makeSafeId(raw: string): string {
  return (
    safeDecodeURIComponent(raw)
      .trim()
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/\s+/g, "-")
      .replace(/_/g, "-")
      .replace(/[^a-z0-9._\-@()[\]%?#+=/&:]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "unknown"
  );
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeGroup(raw: string): string {
  const text = normalizeWhitespace(raw);
  const lowerText = text.toLowerCase();

  if (!text) return "";

  for (const group of KNOWN_GROUPS) {
    if (group.patterns.some((pattern) => pattern.test(lowerText))) {
      return group.title;
    }
  }

  return text;
}

function detectGroupFromTitle(title: string): string {
  const lowerTitle = title.toLowerCase();

  for (const group of KNOWN_GROUPS) {
    if (group.patterns.some((pattern) => pattern.test(lowerTitle))) {
      return group.title;
    }
  }

  return "";
}

function isLikelyChapterNote(value: string): boolean {
  return /\b(afterword|bonus|epilogue|extra|finale|interlude|note|omake|oneshot|one-shot|prologue|side\s*story|special|teaser)\b/i.test(
    value,
  );
}

function cleanUploaderCandidate(value: string): string {
  return normalizeWhitespace(value);
}

function isDateLike(value: string): boolean {
  const text = cleanUploaderCandidate(value);
  if (!text) return false;

  return (
    /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(text) ||
    /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(text) ||
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}$/i.test(
      text,
    ) ||
    /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{2,4}$/i.test(
      text,
    ) ||
    /^(today|yesterday)$/i.test(text) ||
    /^\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.test(text)
  );
}

function detectGroupFromBracket(title: string): string {
  const bracketMatches = title.matchAll(/(?:\[([^\]]{2,80})\]|\(([^()]{2,80})\))/g);

  for (const match of bracketMatches) {
    const value = normalizeWhitespace(match[1] ?? match[2] ?? "");
    if (!value) continue;

    const knownGroup = detectGroupFromTitle(value);
    if (knownGroup) return knownGroup;

    if (/\b(scans?|scanlations?|translations?|translators?|team|group)\b/i.test(value)) {
      return normalizeGroup(value);
    }

    if (!isDateLike(value) && !isLikelyChapterNote(value)) return normalizeGroup(value);
  }

  return "";
}

function buildVersion(group: string, uploader: string): string | undefined {
  if (!group) return uploader || undefined;
  if (!uploader || group.toLowerCase() === uploader.toLowerCase()) return group;

  return `${group} - ${uploader}`;
}

function isOfficialUploader(uploader: string): boolean {
  return OFFICIAL_UPLOADERS.has(uploader.replace(/\s+/g, " ").trim().toLowerCase());
}

export function buildChapterVersion(rawUploader: string, rawTitle = ""): string | undefined {
  const uploader = normalizeGroup(rawUploader);
  const detectedGroup =
    detectGroupFromBracket(rawTitle) ||
    detectGroupFromTitle(rawTitle) ||
    (isOfficialUploader(rawUploader) ? "Official" : "");

  return buildVersion(detectedGroup, uploader);
}

function firstUploaderCandidate(candidates: string[], chapterTitle: string): string {
  return (
    candidates
      .map(cleanUploaderCandidate)
      .find(
        (candidate) =>
          candidate &&
          candidate !== chapterTitle &&
          !candidate.includes(chapterTitle) &&
          !isDateLike(candidate),
      ) ?? ""
  );
}

function extractUploader($row: cheerio.Cheerio<any>): string {
  const chapterTitle = cleanUploaderCandidate($row.find("a.chico").first().text());

  const profileUploader = firstUploaderCandidate(
    $row
      .find("a[href*='/home/'], a[href*='/user/'], a[href*='/profile/']")
      .not("a.chico")
      .toArray()
      .map((element) => $row.find(element).text()),
    chapterTitle,
  );
  if (profileUploader) return profileUploader;

  const explicitCandidates = $row
    .find(
      "td.no a, td.no, td.uk-table-shrink a, td.uk-table-shrink, td[class*='upload'] a, td[class*='upload'], td[class*='group'] a, td[class*='group']",
    )
    .toArray()
    .map((element) => $row.find(element).text());

  const explicitUploader = firstUploaderCandidate(explicitCandidates, chapterTitle);
  if (explicitUploader) return explicitUploader;

  const linkUploader = firstUploaderCandidate(
    $row
      .find("td a")
      .not("a.chico")
      .toArray()
      .map((element) => $row.find(element).text()),
    chapterTitle,
  );
  if (linkUploader) return linkUploader;

  return firstUploaderCandidate(
    $row
      .find("td")
      .not((_, cell) => $row.find(cell).find("a.chico").length > 0)
      .toArray()
      .map((cell) => $row.find(cell).text()),
    chapterTitle,
  );
}

function toPathname(href: string): string {
  const normalizedHref = href.trim();
  if (!normalizedHref) return "";

  try {
    return new URL(normalizedHref, DOMAIN).pathname;
  } catch {
    const extracted = extractMangaId(normalizedHref);

    try {
      return new URL(extracted, DOMAIN).pathname;
    } catch {
      return extracted;
    }
  }
}

function originalChapterUrlFromHref(href: string, chapterId: string): string {
  if (href.startsWith("/")) return chapterUrlFromId(href);
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("http://") || href.startsWith("https://")) return chapterUrlFromId(href);

  return chapterUrlFromId(chapterId);
}

function routeReaderUrlToMirror(url: string): string {
  const mangagoReaderMatch =
    /^(?:https?:)?\/\/(?:www\.)?(?:mangago\.me|mangago\.zone|youhim\.me)(\/(?:chapter|read-manga)\/[^#?]*)([^#]*)?(#.*)?$/i.exec(
      url,
    );

  if (mangagoReaderMatch) {
    return `${READER_DOMAIN}${mangagoReaderMatch[1]}${mangagoReaderMatch[2] ?? ""}${
      mangagoReaderMatch[3] ?? ""
    }`;
  }

  try {
    const parsed = new URL(url, DOMAIN);
    const host = parsed.hostname.toLowerCase();
    const isMangagoMirror =
      host === "mangago.me" ||
      host.endsWith(".mangago.me") ||
      host === "mangago.zone" ||
      host.endsWith(".mangago.zone") ||
      host === "youhim.me" ||
      host.endsWith(".youhim.me");
    const isReaderPath =
      parsed.pathname.startsWith("/chapter/") || parsed.pathname.startsWith("/read-manga/");

    if (isMangagoMirror && isReaderPath) {
      return `${READER_DOMAIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }

    return url;
  } catch {
    if (
      url.startsWith("/chapter/") ||
      url.startsWith("/read-manga/") ||
      url.startsWith("chapter/") ||
      url.startsWith("read-manga/")
    ) {
      return `${READER_DOMAIN}${url.startsWith("/") ? url : `/${url}`}`;
    }

    return url;
  }
}

export function parseListings(html: string): SearchResultItem[] {
  const $ = cheerio.load(html);
  const items: SearchResultItem[] = [];
  const seen = new Set<string>();

  function cleanText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  function pushListing($item: cheerio.Cheerio<any>): void {
    const $link =
      $item.find("a.thm-effect").first().length > 0
        ? $item.find("a.thm-effect").first()
        : $item.find("a[href*='/read-manga/']").first();

    if ($link.length === 0) return;

    const href = $link.attr("href") ?? "";
    try {
      const path = new URL(href, DOMAIN).pathname;
      if (/\/pg-\d+\/?$/i.test(path)) return;
    } catch {
      if (/\/pg-\d+\/?$/i.test(href)) return;
    }
    const mangaId = toPathname(href);
    if (!mangaId || seen.has(mangaId)) return;

    const $img =
      $link.find("img").first().length > 0 ? $link.find("img").first() : $item.find("img").first();

    const title = cleanText(
      $link.attr("title") ??
        $img.attr("alt") ??
        $item.find("a[title]").first().attr("title") ??
        $item.find(".title, .manga-title, .name, h3, h4").first().text() ??
        $link.text(),
    );

    if (!title) return;

    const imageUrl = absoluteUrl(
      $img.attr("data-src") ??
        $img.attr("data-cfsrc") ??
        $img.attr("data-lazy-src") ??
        $img.attr("srcset")?.split(/\s+/)[0] ??
        $img.attr("src") ??
        "",
    );

    const subtitle = cleanText(
      $item.find("p.chapter a, .chapter a, a[href*='/read-manga/'][href*='/c']").first().text(),
    );

    seen.add(mangaId);
    items.push({
      mangaId,
      title,
      imageUrl,
      subtitle: subtitle || undefined,
    });
  }

  $(".updatesli, .pic_list > li, div.pic_list .updatesli, .also-like li").each((_, element) => {
    pushListing($(element));
  });

  if (items.length > 0) return items;

  $("a.thm-effect, a[href*='/read-manga/']").each((_, element) => {
    const $link = $(element);
    const $item = $link.closest("li, div, article");

    pushListing($item.length > 0 ? $item : $link);
  });

  return items;
}

// mangago.zone carousels (homepage "Top" lists and zone /genre/ pages) use a
// stripped mobile layout: each item is a <div class="updatesli"> with a
// <a class="thm-effect" href=".../work/<id>/"> and a lazy <img data-src> cover,
// but NO title/alt text (titles load via JS hover). The desktop parseListings
// requires a title and would drop every item, so this keeps the title-less,
// cover-only items the same way the site itself displays them.
//
// When `heading` is given (homepage), only the carousel under the matching <h2>
// is parsed; otherwise (zone genre page) every result item on the page is used.
export function parseZoneCarousel(html: string, heading?: RegExp): SearchResultItem[] {
  const $ = cheerio.load(html);
  const items: SearchResultItem[] = [];
  const seen = new Set<string>();

  const collect = ($scope: cheerio.Cheerio<any>): void => {
    $scope.find(".updatesli").each((_, element) => {
      const $item = $(element);
      const $link = $item.find("a[href*='/work/'], a.thm-effect").first();
      if ($link.length === 0) return;

      const href = $link.attr("href") ?? "";
      const mangaId = toPathname(href);
      if (!mangaId || seen.has(mangaId)) return;

      const $img = $item.find("img").first();
      const imageUrl = absoluteUrl(
        $img.attr("data-src") ??
          $img.attr("data-cfsrc") ??
          $img.attr("data-lazy-src") ??
          $img.attr("src") ??
          "",
      );

      const title = ($link.attr("title") ?? $img.attr("alt") ?? "").replace(/\s+/g, " ").trim();

      seen.add(mangaId);
      items.push({ mangaId, title, imageUrl });
    });
  };

  if (heading) {
    // The heading <h2> and its carousel share a section wrapper
    // (h2 -> bold div -> section div that also holds the .pic_list).
    const headingEl = $("h2")
      .toArray()
      .find((el) => heading.test($(el).text()));
    if (headingEl) collect($(headingEl).parent().parent());
  } else {
    collect($("body"));
  }

  return items;
}

export function hasNextPage(html: string): boolean {
  const $ = cheerio.load(html);

  return (
    $(".current + li > a").length > 0 ||
    $(".pagination .next a, .pagination a.next, a[rel='next']").length > 0 ||
    $("a")
      .toArray()
      .some((a) => /next/i.test($(a).text()))
  );
}

export function mangaUrlFromId(mangaId: string): string {
  if (mangaId.startsWith("http")) return mangaId;
  return `${DOMAIN}${mangaId}`;
}

export function chapterUrlFromId(chapterId: string): string {
  if (chapterId.startsWith("http")) return routeReaderUrlToMirror(chapterId);

  // Keiyoushi #16599: reader shortcut paths only resolve on mirror domains.
  // Live Paperback testing also shows canonical read-manga reader pages can
  // return 403 while the same path on mangago.zone returns imgsrcs.
  if (
    chapterId.startsWith("/chapter/") ||
    chapterId.startsWith("/read-manga/") ||
    chapterId.startsWith("chapter/") ||
    chapterId.startsWith("read-manga/")
  ) {
    return `${READER_DOMAIN}${chapterId.startsWith("/") ? chapterId : `/${chapterId}`}`;
  }

  return routeReaderUrlToMirror(
    `${DOMAIN}${chapterId.startsWith("/") ? chapterId : `/${chapterId}`}`,
  );
}

export function parseMangaDetails(html: string, mangaId: string): SourceManga {
  const $ = cheerio.load(html);
  const normalizedMangaId = toPathname(mangaId) || mangaId;

  const info = $("#information");

  const title = $(".w-title h1").first().text().trim() || normalizedMangaId;
  const coverImg = info.find("img").first();

  const imageUrl = absoluteUrl(
    coverImg.attr("data-src") ??
      coverImg.attr("data-cfsrc") ??
      coverImg.attr("data-lazy-src") ??
      coverImg.attr("srcset")?.split(/\s+/)[0] ??
      coverImg.attr("src") ??
      "",
  );

  const summary = info.find(".manga_summary").first();
  summary.find("font").remove();

  const description = summary.text().trim();

  let status: MangaInfo["status"] = "UNKNOWN";
  let author = "";
  let artist = "";
  const secondaryTitles: string[] = [];
  const tags: Tag[] = [];
  const tagTitles: string[] = [];

  info.find(".manga_info li, .manga_right tr").each((_, element) => {
    const $el = $(element);
    const label = $el.find("b, label").first().text().trim().toLowerCase();
    const value = $el.find("span").first().text().trim();

    if (label.startsWith("status")) {
      const statusValue = value.toLowerCase();

      if (statusValue === "ongoing") status = "ONGOING";
      else if (statusValue === "completed") status = "COMPLETED";
    }

    if (label.startsWith("author")) {
      author = $el
        .find("a")
        .map((_, a) => $(a).text().trim())
        .get()
        .join(", ");
    }

    if (label.startsWith("artist")) {
      artist = $el
        .find("a")
        .map((_, a) => $(a).text().trim())
        .get()
        .join(", ");
    }

    // Alternative / other names — improves search and tracker (AniList/MAL)
    // matching. Best-effort: if the row's markup doesn't match, the list just
    // stays empty (no regression). mangago separates names with ; / or newlines.
    if (label.startsWith("alternative") || label.includes("other name")) {
      const raw = value || $el.text().replace(/^[^:]*:/, "");
      for (const name of raw.split(/[;/\n]+/).map((s) => s.trim())) {
        if (name && !secondaryTitles.includes(name)) secondaryTitles.push(name);
      }
    }

    if (label.startsWith("genre")) {
      $el.find("a").each((_, a) => {
        const genreTitle = $(a).text().trim();
        if (!genreTitle) return;

        const href = $(a).attr("href") ?? "";
        const rawId = href.match(/\/genre\/([^/?]+)/)?.[1] ?? genreTitle;
        const id = makeSafeId(rawId);

        tagTitles.push(genreTitle);
        tags.push({ id, title: genreTitle });
      });
    }
  });

  const isAdult = tagTitles.some((x) => ["Adult", "Smut", "Yaoi"].includes(x));
  const isMature = tagTitles.some((x) => x === "Ecchi");

  return {
    mangaId: normalizedMangaId,
    mangaInfo: {
      primaryTitle: title,
      secondaryTitles,
      thumbnailUrl: imageUrl,
      synopsis: description,
      author,
      artist,
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
  chapter?: number;
  title?: string;
} {
  const trimmed = input.trim();
  const colon = trimmed.indexOf(":");

  let left = colon >= 0 ? trimmed.slice(0, colon).trim() : trimmed;
  const right = colon >= 0 ? trimmed.slice(colon + 1).trim() : "";

  let chapter: number | undefined;
  let title: string | undefined;

  const volumeMatch = /^Vol\.\s*(?:(\d+(?:\.\d+)?)|TBA|N\/?A|NA)?\s*/i.exec(left);
  if (volumeMatch) {
    left = left.slice(volumeMatch[0].length).trimStart();
  }

  if (/^Ch\./i.test(left)) {
    left = left.slice(3).trimStart();
    const match = /^(\d+(?:\.\d+)?)/.exec(left);
    if (match) {
      chapter = Number(match[1]);
      left = left.slice(match[1].length).trimStart();
    }
  }

  if (right && left) title = `${left}: ${right}`;
  else if (right) title = right;
  else if (left) title = left;

  return { chapter, title };
}

function parseChapterNumber(name: string, chapterId: string): number {
  const rawNumber =
    name.match(/chapter\s*(\d+(?:\.\d+)?)/i)?.[1] ??
    name.match(/ch\.\s*(\d+(?:\.\d+)?)/i)?.[1] ??
    name.match(/(\d+(?:\.\d+)?)/)?.[1] ??
    chapterId.match(/c(\d+(?:\.\d+)?)/i)?.[1];

  const number = rawNumber ? Number(rawNumber) : 0;
  return Number.isFinite(number) ? number : 0;
}

function compareChapterGroups(a: Chapter, b: Chapter): number {
  const aOfficial = a.version?.startsWith("Official") ?? false;
  const bOfficial = b.version?.startsWith("Official") ?? false;

  if (aOfficial && !bOfficial) return -1;
  if (!aOfficial && bOfficial) return 1;

  return (a.version ?? "").localeCompare(b.version ?? "");
}

export function parseChapters(html: string, sourceManga: SourceManga): Chapter[] {
  const $ = cheerio.load(html);
  const chapters: Chapter[] = [];

  $("table#chapter_table > tbody > tr, table.uk-table > tbody > tr").each((_, element) => {
    const $row = $(element);
    const $link = $row.find("a.chico").first();

    const href = ($link.attr("href") ?? "").trim();
    if (!href) return;

    const chapterId = toPathname(href);
    if (!chapterId) return;

    const originalChapterUrl = originalChapterUrlFromHref(href, chapterId);
    const rawTitle = $link.text().trim();
    const parsed = parseChapterTitle(rawTitle);
    const rawUploader = extractUploader($row);
    const version = buildChapterVersion(rawUploader, rawTitle);
    const chapNum = parsed.chapter ?? parseChapterNumber(rawTitle, chapterId);
    const title = parsed.title || rawTitle;

    const dateText = $row.find("td").last().text().trim();
    const parsedDate = dateText ? new Date(dateText) : undefined;
    const publishDate =
      parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate : undefined;

    const chapter = {
      chapterId,
      sourceManga,
      title,
      chapNum,
      volume: 0,
      version,
      publishDate,
      langCode: "en",
      sortingIndex: 0,
      additionalInfo: {
        originalChapterUrl,
      },
    } as Chapter & {
      additionalInfo: {
        originalChapterUrl: string;
      };
    };

    chapters.push(chapter);
  });

  chapters.sort((a, b) => {
    if (a.chapNum === 0 && b.chapNum === 0) return compareChapterGroups(a, b);
    if (a.chapNum === 0) return 1;
    if (b.chapNum === 0) return -1;
    if (a.chapNum !== b.chapNum) return b.chapNum - a.chapNum;

    return compareChapterGroups(a, b);
  });

  return chapters.map((chapter, index) => ({
    ...chapter,
    sortingIndex: chapters.length - index,
  }));
}
