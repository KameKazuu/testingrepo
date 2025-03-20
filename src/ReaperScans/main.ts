import {
    BasicRateLimiter,
    Chapter,
    ChapterDetails,
    ChapterProviding,
    CookieStorageInterceptor,
    DiscoverSection,
    DiscoverSectionItem,
    DiscoverSectionProviding,
    DiscoverSectionType,
    Extension,
    MangaProviding,
    PagedResults,
    Request,
    SearchFilter,
    SearchQuery,
    SearchResultItem,
    SearchResultsProviding,
    SourceManga,
} from "@paperback/types";
import { URLBuilder } from "../utils/url-builder/array-query-variant";
import {
    ReaperChapterDetails,
    ReaperChapterList,
    ReaperMangaDetails,
    ReaperQueryResult,
    ReaperQueryResultData,
    ReaperSearchMetadata,
} from "./interfaces/ReaperScansInterfaces";
import pbconfig from "./pbconfig";
import { RS_API_DOMAIN, RS_DOMAIN } from "./ReaperConfig";
import { ReaperInterceptor } from "./ReaperInterceptor";
import {
    parseChapterDetails,
    parseChapterList,
    parseDailySection,
    parseMangaDetails,
    parseNewSection,
    parseUpdatesSection,
} from "./ReaperParser";
import { checkImage } from "./ReaperUtils";

export class ReaperScansExtension
    implements
        Extension,
        SearchResultsProviding,
        MangaProviding,
        ChapterProviding,
        DiscoverSectionProviding
{
    globalRateLimiter = new BasicRateLimiter("ratelimiter", {
        numberOfRequests: 10,
        bufferInterval: 0.5,
        ignoreImages: true,
    });

    requestManager = new ReaperInterceptor("main");

    cookieStorageInterceptor = new CookieStorageInterceptor({
        storage: "stateManager",
    });

    async initialise(): Promise<void> {
        this.cookieStorageInterceptor.registerInterceptor();
        this.requestManager.registerInterceptor();
        this.globalRateLimiter.registerInterceptor();
        if (Application.isResourceLimited) return;
    }
    async getSearchFilters(): Promise<SearchFilter[]> {
        return [];
    }
    async getSearchResults(
        query: SearchQuery,
        metadata: ReaperSearchMetadata,
    ): Promise<PagedResults<SearchResultItem>> {
        const page = metadata?.page ?? 1;
        const items: SearchResultItem[] = [];
        if (page == -1 || !query) {
            return {
                items,
            };
        }

        const searchString = query.title
            ?.trim()
            .replace(/\s+/g, " ")
            .replace(/ /g, "+");

        const request: Request = {
            url: new URLBuilder(RS_API_DOMAIN)
                .addPath("query")
                .addQuery("adult", "true")
                .addQuery("query_string", searchString)
                .addQuery("perPage", "200")
                .addQuery("page", page)
                .addQuery("series_type", "Comic")
                .build(),
            method: "GET",
            headers: {
                "user-agent": await Application.getDefaultUserAgent(),
                referer: `${RS_DOMAIN}/`,
            },
        };

        const [_, buffer] = await Application.scheduleRequest(request);

        const g = Application.arrayBufferToUTF8String(buffer);
        const results = JSON.parse(g) as ReaperQueryResult;

        for (const item of results.data) {
            const latestChapter =
                item.free_chapters && item.free_chapters.length > 0
                    ? item.free_chapters[0]?.chapter_name
                    : "";
            items.push({
                mangaId: item.series_slug,
                title: item.title ?? "",
                imageUrl: checkImage(item.thumbnail),
                subtitle: latestChapter,
                contentRating: pbconfig.contentRating,
            });
        }

        return {
            items,
        };
    }
    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = {
            url: new URLBuilder(RS_API_DOMAIN)
                .addPath("series")
                .addPath(mangaId)
                .build(),
            method: "GET",
            headers: {
                "user-agent": await Application.getDefaultUserAgent(),
                referer: `${RS_DOMAIN}/`,
            },
        };

        const [_, buffer] = await Application.scheduleRequest(request);

        const mangaDetails = JSON.parse(
            Application.arrayBufferToUTF8String(buffer) ?? "[]",
        ) as ReaperMangaDetails;
        return parseMangaDetails(mangaDetails, mangaId);
    }
    async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
        const request: Request = {
            url: new URLBuilder(RS_API_DOMAIN)
                .addPath("chapters")
                .addPath(sourceManga.mangaId)
                .addQuery("perPage", 30)
                .build(),
            method: "GET",
            headers: {
                "user-agent": await Application.getDefaultUserAgent(),
                referer: `${RS_DOMAIN}/`,
            },
        };
        const [_, buffer] = await Application.scheduleRequest(request);

        const chapterList = JSON.parse(
            Application.arrayBufferToUTF8String(buffer) ?? "[]",
        ) as ReaperChapterList;
        let chapterListMeta = chapterList.meta;
        while (chapterListMeta.current_page < chapterListMeta.last_page) {
            const request: Request = {
                url: new URLBuilder(RS_API_DOMAIN)
                    .addPath("chapters")
                    .addPath(sourceManga.mangaId)
                    .addQuery("perPage", 30)
                    .addQuery("page", chapterListMeta.current_page + 1)
                    .build(),
                method: "GET",
                headers: {
                    "user-agent": await Application.getDefaultUserAgent(),
                    referer: `${RS_DOMAIN}/`,
                },
            };
            const [_, buffer] = await Application.scheduleRequest(request);
            const newChapterList = JSON.parse(
                Application.arrayBufferToUTF8String(buffer) ?? "[]",
            ) as ReaperChapterList;
            chapterList.data = chapterList.data.concat(newChapterList.data);
            chapterListMeta = newChapterList.meta;
        }
        return parseChapterList(chapterList, sourceManga);
    }
    async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
        const request: Request = {
            url: new URLBuilder(RS_API_DOMAIN)
                .addPath("chapter")
                .addPath(chapter.sourceManga.mangaId)
                .addPath(chapter.chapterId)
                .build(),
            method: "GET",
            headers: {
                "user-agent": await Application.getDefaultUserAgent(),
                referer: `${RS_DOMAIN}/`,
            },
        };

        const [_, buffer] = await Application.scheduleRequest(request);

        const json = JSON.parse(
            Application.arrayBufferToUTF8String(buffer) ?? "[]",
        ) as ReaperChapterDetails;

        return parseChapterDetails(json, chapter);
    }
    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return [
            {
                id: "daily",
                title: "Popular Today",
                type: DiscoverSectionType.featured,
            },
            {
                id: "new",
                title: "New Comics",
                type: DiscoverSectionType.simpleCarousel,
            },

            {
                id: "latest",
                title: "Latest Updates",
                type: DiscoverSectionType.chapterUpdates,
            },
        ];
    }
    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: ReaperSearchMetadata | undefined,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        const page = metadata?.page ?? 1;
        let items: DiscoverSectionItem[] = [];

        switch (section.type) {
            case DiscoverSectionType.simpleCarousel:
                {
                    const request = {
                        url: new URLBuilder(RS_API_DOMAIN)
                            .addPath("query")
                            // .addQuery("series_type", "Comic")
                            .addQuery("perPage", "15")
                            .addQuery("order", "desc")
                            .addQuery("orderBy", "created_at")
                            .addQuery("page", page.toString())
                            .build(),
                        method: "GET",
                        headers: {
                            "user-agent":
                                await Application.getDefaultUserAgent(),
                            referer: `${RS_DOMAIN}/`,
                        },
                    };

                    const [_, buffer] =
                        await Application.scheduleRequest(request);

                    const json = JSON.parse(
                        Application.arrayBufferToUTF8String(buffer) ?? "[]",
                    ) as ReaperQueryResult;

                    items = parseNewSection(json);
                    metadata =
                        page == json.meta.last_page
                            ? undefined
                            : { page: page + 1 };
                }
                break;
            case DiscoverSectionType.chapterUpdates:
                {
                    const request = {
                        url: new URLBuilder(RS_API_DOMAIN)
                            .addPath("query")
                            // .addQuery("series_type", "Comic")
                            .addQuery("perPage", "15")
                            .addQuery("order", "desc")
                            .addQuery("orderBy", "updated_at")
                            .addQuery("page", page)
                            .build(),
                        method: "GET",
                        headers: {
                            "user-agent":
                                await Application.getDefaultUserAgent(),
                            referer: `${RS_DOMAIN}/`,
                        },
                    };

                    const [_, buffer] =
                        await Application.scheduleRequest(request);

                    const json = JSON.parse(
                        Application.arrayBufferToUTF8String(buffer) ?? "[]",
                    ) as ReaperQueryResult;

                    items = parseUpdatesSection(json);
                    metadata =
                        page == json.meta.last_page
                            ? undefined
                            : { page: page + 1 };
                }
                break;
            case DiscoverSectionType.featured:
                {
                    const request = {
                        url: new URLBuilder(RS_API_DOMAIN)
                            .addPath("trending")
                            .build(),
                        method: "GET",
                        headers: {
                            "user-agent":
                                await Application.getDefaultUserAgent(),
                            referer: `${RS_DOMAIN}/`,
                        },
                    };

                    const [_, buffer] =
                        await Application.scheduleRequest(request);

                    const json = JSON.parse(
                        Application.arrayBufferToUTF8String(buffer) ?? "[]",
                    ) as ReaperQueryResultData[];

                    items = parseDailySection(json);
                }
                break;
            default:
                break;
        }

        return {
            items,
            metadata,
        };
    }
}

export const ReaperScans = new ReaperScansExtension();
