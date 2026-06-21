import {
  BasicRateLimiter,
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type Extension,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { DOMAIN, type MangagoSearchMetadata } from "./models";
import { MangagoInterceptor, fetchText } from "./network";
import {
  chapterUrlFromId,
  hasNextPage,
  mangaUrlFromId,
  parseChapters,
  parseListings,
  parseMangaDetails,
} from "./parsers";
import { getMangagoPageUrls } from "./utils";

class MangagoExtension implements Extension {
  private interceptor = new MangagoInterceptor("mangago-interceptor");

  private rateLimiter = new BasicRateLimiter("mangago-rate-limiter", {
    numberOfRequests: 3,
    bufferInterval: 1,
    ignoreImages: false,
  });

  async initialise(): Promise<void> {
    this.rateLimiter.registerInterceptor();
    this.interceptor.registerInterceptor();
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return [
      {
        id: "popular",
        label: "Popular",
      },
      {
        id: "latest",
        label: "Latest Updates",
      },
    ];
  }

  async getSearchResults(
    query: SearchQuery<MangagoSearchMetadata>,
    metadata?: MangagoSearchMetadata,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = metadata?.page ?? 1;
    const title = query.title?.trim() ?? "";

    let url: string;

    if (title) {
      url = `${DOMAIN}/r/l_search?name=${encodeURIComponent(title)}&page=${page}`;
    } else if (sortingOption?.id === "latest") {
      url = `${DOMAIN}/genre/all/${page}/?f=1&o=1&sortby=update_date&e=`;
    } else {
      url = `${DOMAIN}/genre/all/${page}/?f=1&o=1&sortby=view&e=`;
    }

    const html = await fetchText(url);
    const items = parseListings(html);

    return {
      items,
      metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
    };
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: "popular",
        title: "Popular",
        type: DiscoverSectionType.featured,
      },
      {
        id: "latest",
        title: "Latest Updates",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: MangagoSearchMetadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const page = metadata?.page ?? 1;
    const sortby = section.id === "latest" ? "update_date" : "view";
    const url = `${DOMAIN}/genre/all/${page}/?f=1&o=1&sortby=${sortby}&e=`;

    const html = await fetchText(url);
    const searchItems = parseListings(html);

    const items: DiscoverSectionItem[] = searchItems.map((item) => ({
      type: "manga",
      mangaId: item.mangaId,
      title: item.title,
      imageUrl: item.imageUrl,
    }));

    return {
      items,
      metadata: hasNextPage(html) ? { page: page + 1 } : undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const html = await fetchText(mangaUrlFromId(mangaId));
    return parseMangaDetails(html, mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const html = await fetchText(mangaUrlFromId(sourceManga.mangaId));
    return parseChapters(html, sourceManga.mangaId);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const chapterUrl = chapterUrlFromId(chapter.chapterId);
    const pages = await getMangagoPageUrls(chapterUrl);

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages,
    };
  }
}

export const Mangago = new MangagoExtension();
