import {
  Chapter,
  ChapterDetails,
  DiscoverSectionItem,
  SourceManga,
  Tag,
  TagSection,
} from "@paperback/types";
import { load } from "cheerio";
import { URLBuilder } from "../utils/url-builder/base";
import {
  ReaperChapterDetails,
  ReaperChapterList,
  ReaperMangaDetails,
  ReaperQueryResult,
  ReaperQueryResultData,
  ReaperTag,
} from "./interfaces/ReaperScansInterfaces";
import pbconfig from "./pbconfig";
import { RS_DOMAIN } from "./ReaperConfig";
import { checkImage } from "./ReaperUtils";

export const parseMangaDetails = (
  mangaDetails: ReaperMangaDetails,
  mangaId: string,
): SourceManga => {
  const $ = load(mangaDetails.description);

  const description = $("p")
    .map((_, el) => $(el).text().trim())
    .get()
    .join(" ");

  return {
    mangaId,
    mangaInfo: {
      thumbnailUrl: checkImage(mangaDetails.thumbnail),
      synopsis: description,
      primaryTitle: mangaDetails.title,
      secondaryTitles: mangaDetails.alternative_names.split("|"),
      contentRating: pbconfig.contentRating,
      status: mangaDetails.status,
      author: mangaDetails.author,
      bannerUrl: mangaDetails.meta.background ?? undefined,
      rating: mangaDetails.rating / 5,
      tagGroups: parseTags(mangaDetails),

      shareUrl: new URLBuilder(RS_DOMAIN)
        .addPath("series")
        .addPath(mangaId)
        .build(),
    },
  };
};

export const parseTags = (mangaDetails: ReaperMangaDetails): TagSection[] => {
  const createTags = (filterItems: ReaperTag[], prefix: string): Tag[] => {
    return filterItems.map((item: { id: number | string; name: string }) => ({
      id: `${prefix}_${item.id ?? item.name}`,
      title: item.name,
    }));
  };
  // throw new Error(tagSections.length.toString())
  const genres: TagSection = {
    id: "0",
    title: "Genres",
    tags: createTags(mangaDetails.tags, "genre"),
  };
  return [genres];
};

export const parseChapterList = (
  chapterList: ReaperChapterList,
  sourceManga: SourceManga,
): Chapter[] => {
  const chapters: Chapter[] = [];
  let sortingIndex = 0;

  for (const chapter of chapterList.data) {
    const date = new Date(
      (chapter.created_at ?? "").replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1"),
    );
    chapters.push({
      chapterId: chapter.chapter_slug,
      title: chapter.chapter_title ?? "",
      langCode: "🇬🇧",
      chapNum: Number(chapter.index),
      volume: 0,
      publishDate: date,
      sortingIndex,
      sourceManga,
    });
    sortingIndex--;
  }

  return chapters;
};

export const parseChapterDetails = (
  chapterDetails: ReaperChapterDetails,
  chapter: Chapter,
): ChapterDetails => {
  const pages: string[] = [];
  if (
    chapterDetails.chapter?.storage == "local" &&
    chapterDetails.chapter.chapter_data &&
    "images" in chapterDetails.chapter.chapter_data
  ) {
    for (const image of chapterDetails.chapter.chapter_data.images) {
      pages.push(checkImage(image));
    }
  } else if (
    chapterDetails.chapter.storage == "s3" &&
    chapterDetails.chapter.chapter_data &&
    "files" in chapterDetails.chapter.chapter_data
  ) {
    for (const image of chapterDetails.chapter.chapter_data.files) {
      pages.push(checkImage(image.url));
    }
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
};

export const parseNewSection = (
  queryResult: ReaperQueryResult,
): DiscoverSectionItem[] => {
  const items: DiscoverSectionItem[] = [];
  for (const item of queryResult.data) {
    items.push({
      type: "simpleCarouselItem",
      mangaId: item.series_slug,
      imageUrl: item.thumbnail,
      title: item.title,
    });
  }
  return items;
};

export const parseUpdatesSection = (
  queryResult: ReaperQueryResult,
): DiscoverSectionItem[] => {
  const items: DiscoverSectionItem[] = [];
  for (const item of queryResult.data) {
    const latestChapterSlug =
      item.free_chapters && item.free_chapters.length > 0
        ? item.free_chapters[0].chapter_slug
        : " ";
    const latestChapterName =
      item.free_chapters && item.free_chapters.length > 0
        ? item.free_chapters[0].chapter_name
        : " ";
    items.push({
      type: "chapterUpdatesCarouselItem",
      mangaId: item.series_slug,
      imageUrl: checkImage(item.thumbnail),
      title: item.title,
      chapterId: latestChapterSlug,
      subtitle: latestChapterName,
    });
  }
  return items;
};

export const parseDailySection = (
  queryResult: ReaperQueryResultData[],
): DiscoverSectionItem[] => {
  const items: DiscoverSectionItem[] = [];
  for (const item of queryResult) {
    items.push({
      type: "featuredCarouselItem",
      mangaId: item.series_slug,
      imageUrl: checkImage(item.thumbnail),
      title: item.title,
    });
  }
  return items;
};
