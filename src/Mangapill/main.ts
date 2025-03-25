import {
    BasicRateLimiter,
    Chapter,
    ChapterDetails,
    ChapterProviding,
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
    Tag,
    TagSection,
} from "@paperback/types";
import * as cheerio from "cheerio";
import { URLBuilder } from "../utils/url-builder/array-query-variant";
import { MANGA_PILL_DOMAIN } from "./MangapillConfig";
import { getFilterTagsBySection, getShareUrl } from "./MangapillHelper";
import { MangapillInterceptor } from "./MangapillInterceptor";
import {
    parseChapterDetails,
    parseChapters,
    parseMangaDetails,
    parseRecentSection,
    parseSearch,
    parseTags,
    parseTrendingSection,
} from "./MangapillParser";

export class MangapillExtension
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

    requestManager = new MangapillInterceptor("main");

    async initialise(): Promise<void> {
        this.globalRateLimiter.registerInterceptor();
        this.requestManager.registerInterceptor();
        if (Application.isResourceLimited) return;
    }

    async getDiscoverSections(): Promise<DiscoverSection[]> {
        return [
            {
                id: "trending",
                title: "Trending Mangas",
                type: DiscoverSectionType.featured,
            },

            {
                id: "recent",
                title: "Recently Updated",
                type: DiscoverSectionType.chapterUpdates,
            },

            { id: "genre", title: "Genres", type: DiscoverSectionType.genres },
        ];
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: undefined,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        let items: DiscoverSectionItem[] = [];
        const urlBuilder = new URLBuilder(MANGA_PILL_DOMAIN);

        switch (section.id) {
            case "trending": {
                const [_, buffer] = await Application.scheduleRequest({
                    url: urlBuilder.build(),
                    method: "GET",
                });
                const $ = cheerio.load(
                    Application.arrayBufferToUTF8String(buffer),
                );
                items = await parseTrendingSection($);
                break;
            }
            case "recent": {
                const [_, buffer] = await Application.scheduleRequest({
                    url: urlBuilder.build(),
                    method: "GET",
                });
                const $ = cheerio.load(
                    Application.arrayBufferToUTF8String(buffer),
                );
                items = await parseRecentSection($);
                break;
            }
            case "genre": {
                const genres = await this.getGenres();
                items = genres.map((genre) => ({
                    type: "genresCarouselItem",
                    searchQuery: {
                        title: "",
                        filters: [
                            {
                                id: "genre",
                                value: { [genre.id]: "included" },
                            },
                        ],
                    },
                    name: genre.title,
                    metadata: metadata,
                }));
            }
        }
        return { items, metadata };
    }

    getMangaShareUrl(mangaId: string): string {
        return getShareUrl(mangaId);
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const request = {
            url: new URLBuilder(MANGA_PILL_DOMAIN)
                .addPath("manga")
                .addPath(mangaId)
                .build(),
            method: "GET",
        };

        const [_, buffer] = await Application.scheduleRequest(request);

        const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
        return await parseMangaDetails($, mangaId);
    }

    async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
        const request = {
            url: new URLBuilder(MANGA_PILL_DOMAIN)
                .addPath("manga")
                .addPath(sourceManga.mangaId)
                .build(),
            method: "GET",
        };
        const [_, buffer] = await Application.scheduleRequest(request);
        const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
        return parseChapters($, sourceManga);
    }

    async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
        const url = new URLBuilder(MANGA_PILL_DOMAIN)
            .addPath("chapters")
            .addPath(chapter.chapterId)
            .build();

        const request: Request = { url, method: "GET" };

        const [_, buffer] = await Application.scheduleRequest(request);
        const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
        return parseChapterDetails(
            $,
            chapter.sourceManga.mangaId,
            chapter.chapterId,
        );
    }

    async supportsTagExclusion(): Promise<boolean> {
        return false;
    }

    async getGenres(): Promise<Tag[]> {
        const tags = await this.getSearchTags();
        return tags[0].tags;
    }

    async getSearchTags(): Promise<TagSection[]> {
        try {
            const request = {
                url: new URLBuilder(MANGA_PILL_DOMAIN)
                    .addPath("search")
                    .build(),
                method: "GET",
            };

            const [_, buffer] = await Application.scheduleRequest(request);
            const $ = cheerio.load(Application.arrayBufferToUTF8String(buffer));
            return await parseTags($);
        } catch (error) {
            throw new Error(error as string);
        }
    }

    async getSearchFilters(): Promise<SearchFilter[]> {
        const tags = await this.getSearchTags();
        return [this.getGenresFilter(tags)];
    }

    async getSearchResults(
        query: SearchQuery,
        metadata: undefined,
    ): Promise<PagedResults<SearchResultItem>> {
        let newUrlBuilder: URLBuilder = new URLBuilder(
            MANGA_PILL_DOMAIN,
        ).addPath("search");

        if (query.title) {
            newUrlBuilder = newUrlBuilder.addQuery("q", query.title);
        }
        console.log(JSON.stringify(query.filters));
        newUrlBuilder = newUrlBuilder.addQuery(
            "genre",
            getFilterTagsBySection("genre", query.filters),
        );
        console.log(newUrlBuilder.build());
        const response = await Application.scheduleRequest({
            url: newUrlBuilder.build(),
            method: "GET",
        });
        const $ = cheerio.load(
            Application.arrayBufferToUTF8String(response[1]),
        );

        const items = await parseSearch($);
        return { items, metadata };
    }

    getGenresFilter(tags: TagSection[]): SearchFilter {
        const tag = tags[0];
        return {
            id: tag.id,
            title: tag.title,
            type: "multiselect",
            options: tag.tags.map((x) => ({ id: x.id, value: x.title })),
            allowExclusion: false,
            value: {},
            allowEmptySelection: false,
            maximum: undefined,
        };
    }
}

export const Mangapill = new MangapillExtension();
