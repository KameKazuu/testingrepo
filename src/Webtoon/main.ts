import {
    Chapter,
    ChapterDetails,
    ChapterProviding,
    DiscoverSection,
    DiscoverSectionItem,
    DiscoverSectionProviding,
    DiscoverSectionType,
    PagedResults,
    SearchFilter,
    SearchQuery,
    SearchResultItem,
    SearchResultsProviding,
    SourceManga,
} from "@paperback/types";
import { getLanguagesTitle, haveTrending, Language } from "./WebtoonI18NHelper";
import { WebtoonInfra } from "./WebtoonInfra";
import { Tag, WebtoonsSearchingMetadata } from "./WebtoonParser";

export const BASE_URL = "https://www.webtoons.com";
export const MOBILE_URL = "https://m.webtoons.com";

export class WebtoonExtention
    extends WebtoonInfra
    implements
        SearchResultsProviding,
        ChapterProviding,
        DiscoverSectionProviding
{
    constructor() {
        super(BASE_URL, MOBILE_URL);
    }

    getMangaDetails(mangaId: string): Promise<SourceManga> {
        return this.ExecRequest(
            {
                url: `${this.BASE_URL}/${mangaId}`,
            },
            ($) => this.parseDetails($, mangaId),
        );
    }

    getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
        return this.ExecRequest(
            {
                url: `${this.MOBILE_URL}/${sourceManga.mangaId}`,
                headers: { referer: this.MOBILE_URL },
            },
            ($) => this.parseChaptersList($, sourceManga),
        );
    }

    getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
        return this.ExecRequest(
            {
                url: `${this.BASE_URL}/${chapter.chapterId}`,
            },
            ($) => this.parseChapterDetails($, chapter),
        );
    }

    getPopularTitles(
        language: Language,
    ): Promise<PagedResults<SearchResultItem>> {
        return this.ExecPagedResultsRequest(
            { url: `${this.BASE_URL}/${language}/popular` },
            { page: 0, maxPages: 1 },
            ($) => this.parsePopularTitles($),
        );
    }

    getTodayTitles(
        language: Language,
        metadata: WebtoonsSearchingMetadata | undefined,
    ): Promise<PagedResults<SearchResultItem>> {
        return this.ExecPagedResultsRequest(
            { url: `${this.BASE_URL}/${language}/originals` },
            { page: metadata?.page ?? 0, maxPages: 2 },
            ($) => this.parseTodayTitles($, metadata?.page ? true : false),
        );
    }

    getOngoingTitles(
        language: Language,
        metadata: WebtoonsSearchingMetadata | undefined,
    ): Promise<PagedResults<SearchResultItem>> {
        return this.ExecPagedResultsRequest(
            { url: `${this.BASE_URL}/${language}/originals` },
            { page: metadata?.page ?? 0, maxPages: 2 },
            ($) => this.parseOngoingTitles($, metadata?.page ? true : false),
        );
    }

    getCompletedTitles(
        language: Language,
        metadata: WebtoonsSearchingMetadata | undefined,
    ): Promise<PagedResults<SearchResultItem>> {
        return this.ExecPagedResultsRequest(
            { url: `${this.BASE_URL}/${language}/originals` },
            { page: metadata?.page ?? 0, maxPages: 2 },
            ($) => this.parseCompletedTitles($, metadata?.page ? true : false),
        );
    }

    getCanvasRecommendedTitles(
        language: Language,
    ): Promise<PagedResults<SearchResultItem>> {
        return this.ExecRequest(
            { url: `${this.BASE_URL}/${language}/canvas` },
            ($) => this.parseCanvasRecommendedTitles($),
        );
    }

    getCanvasPopularTitles(
        language: Language,
        metadata: WebtoonsSearchingMetadata | undefined,
        genre?: string,
    ): Promise<PagedResults<SearchResultItem>> {
        return this.ExecPagedResultsRequest(
            {
                url: `${this.BASE_URL}/${language}/canvas/list`,
                params: { genreTab: genre ?? "ALL", sortOrder: "READ_COUNT" },
            },
            { page: metadata?.page ?? 0 },
            ($) => this.parseCanvasPopularTitles($),
        );
    }

    getTitlesByGenre(
        language: Language,
        genre: string,
    ): Promise<PagedResults<SearchResultItem>> {
        return this.ExecRequest(
            {
                url: `${this.BASE_URL}/${language}/genres/${genre}`,
                params: { sortOrder: "READ_COUNT" },
            },
            ($) => this.parseTagResults($),
        );
    }

    getTitlesByKeyword(
        language: Language,
        keyword: string,
        metadata: WebtoonsSearchingMetadata | undefined,
    ): Promise<PagedResults<SearchResultItem>> {
        return this.ExecPagedResultsRequest(
            {
                url: `${this.BASE_URL}/${language}/search`,
                params: {
                    keyword: keyword,
                    ...(this.canvasWanted ? {} : { searchType: "WEBTOON" }),
                },
            },
            { page: metadata?.page ?? 0 },
            ($) => this.parseSearchResults($),
        );
    }

    getSearchResults(
        query: SearchQuery,
        metadata: WebtoonsSearchingMetadata | undefined,
    ): Promise<PagedResults<SearchResultItem>> {
        const genre = (query.filters[0]?.value as string) ?? "ALL";

        const result: Promise<PagedResults<SearchResultItem>>[] = [];
        this.languages.forEach((language) => {
            result.push(
                genre !== "ALL"
                    ? genre.startsWith("CANVAS$$")
                        ? this.getCanvasPopularTitles(
                              language,
                              metadata,
                              genre.split("$$")[1],
                          )
                        : this.getTitlesByGenre(language, genre)
                    : query.title
                      ? this.getTitlesByKeyword(language, query.title, metadata)
                      : Promise.resolve({ items: [] }),
            );
        });

        return Promise.all(result).then((res) => {
            return {
                items: res.flatMap((r) => r.items),
                metadata: res[0].metadata,
            };
        });
    }

    async getSearchFilters(): Promise<SearchFilter[]> {
        const genres = await this.getSearchGenres();
        return [
            {
                id: "0",
                title: "Genres",
                type: "dropdown",
                options: genres,
                value: "ALL",
            },
        ];
    }

    async getDiscoverSectionItems(
        section: DiscoverSection,
        metadata: WebtoonsSearchingMetadata | undefined,
    ): Promise<PagedResults<DiscoverSectionItem>> {
        let result: PagedResults<SearchResultItem> = { items: [] };
        const [languagestr, sectionId] = section.id.split("-_-");
        const language = languagestr as Language;

        console.log(
            `get discover section items: ${section.id} ${language} ${sectionId}`,
        );
        switch (sectionId) {
            case "popular":
                result = await this.getPopularTitles(language);
                break;
            case "today":
                result = await this.getTodayTitles(language, metadata);
                break;
            case "ongoing":
                result = await this.getOngoingTitles(language, metadata);
                break;
            case "completed":
                result = await this.getCompletedTitles(language, metadata);
                break;
            case "canvas_recommended":
                result = await this.getCanvasRecommendedTitles(language);
                break;
            case "canvas_popular":
                result = await this.getCanvasPopularTitles(language, metadata);
                break;
        }

        return {
            items: result.items.map((item) => ({
                type: "simpleCarouselItem",
                ...item,
            })),
            metadata: result.metadata,
        };
    }

    getDiscoverSections(): Promise<DiscoverSection[]> {
        const result: DiscoverSection[] = [];
        this.languages.forEach((language) => {
            result.push(...this.getLanguageDiscoverSections(language));
        });
        console.log("result " + JSON.stringify(result));
        return Promise.resolve(result);
    }

    getLanguageDiscoverSections(language: Language): DiscoverSection[] {
        const idBegin = `${language}-_-`;
        const titleBegin =
            this.languages.length > 1
                ? `${getLanguagesTitle(language)} - `
                : "";
        return [
            ...(haveTrending(language)
                ? [
                      {
                          id: `${idBegin}popular`,
                          title: `${titleBegin}New & Trending`,
                          type: DiscoverSectionType.simpleCarousel,
                      },
                  ]
                : []),
            {
                id: `${idBegin}today`,
                title: `${titleBegin}Today release`,
                type: DiscoverSectionType.simpleCarousel,
            },
            {
                id: `${idBegin}ongoing`,
                title: `${titleBegin}Ongoing`,
                type: DiscoverSectionType.simpleCarousel,
            },
            {
                id: `${idBegin}completed`,
                title: `${titleBegin}Completed`,
                type: DiscoverSectionType.simpleCarousel,
            },
            ...(this.canvasWanted
                ? [
                      {
                          id: `${idBegin}canvas_recommended`,
                          title: `${titleBegin}Canvas Recommended`,
                          type: DiscoverSectionType.simpleCarousel,
                      },
                      {
                          id: `${idBegin}canvas_popular`,
                          title: `${titleBegin}Canvas Popular`,
                          type: DiscoverSectionType.simpleCarousel,
                      },
                  ]
                : []),
        ];
    }

    // TODO GENRES LOCALISATION
    async getSearchGenres(): Promise<Tag[]> {
        return [
            { id: "ALL", value: "All" },
            ...(await this.ExecRequest(
                { url: `${this.BASE_URL}/en/genres` },
                ($) => this.parseGenres($),
            )),
            ...(this.canvasWanted
                ? await this.ExecRequest(
                      { url: `${this.BASE_URL}/en/canvas` },
                      ($) => this.parseCanvasGenres($),
                  )
                : []),
        ];
    }
}

export const Webtoon = new WebtoonExtention();
