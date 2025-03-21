import {
    Chapter,
    ChapterDetails,
    SourceManga,
    UpdateManager,
    URL,
} from "@paperback/types";
import { relevanceScore } from "../../utils/titleRelevanceScore";
import { MDLanguages } from "../MangaDexHelper";
import {
    getBlockedGroups,
    getDataSaver,
    getForcePort443,
    getFuzzyBlockingEnabled,
    getGroupBlockingEnabled,
    getLanguages,
    getMetadataUpdater,
    getOptimizeUpdates,
    getRatings,
    getSkipNewChapters,
    getSkipPublicationStatus,
    getSkipSameChapter,
    getSkipUnreadChapters,
    getUpdateBatchSize,
} from "../MangaDexSettings";
import { checkId, fetchJSON, MANGADEX_API } from "../utils/CommonUtil";
import { MangaProvider } from "./MangaProvider";

/**
 * Handles fetching and processing of manga chapters
 */
export class ChapterProvider {
    private mangaProvider: MangaProvider;

    constructor(mangaProvider: MangaProvider) {
        this.mangaProvider = mangaProvider;
    }

    /**
     * Fetches chapters for a manga, optionally updating metadata
     */
    async getChapters(
        sourceManga: SourceManga,
        skipMetadataUpdate: boolean = false,
    ): Promise<Chapter[]> {
        const mangaId = sourceManga.mangaId;
        checkId(mangaId);

        const metadataUpdaterEnabled =
            !skipMetadataUpdate && getMetadataUpdater();
        if (metadataUpdaterEnabled) {
            const updatedManga =
                await this.mangaProvider.getMangaDetails(mangaId);
            sourceManga.mangaInfo = updatedManga.mangaInfo;
        }

        const languages: string[] = getLanguages();
        const skipSameChapter = getSkipSameChapter();
        const ratings: string[] = getRatings();
        const groupBlockingEnabled = getGroupBlockingEnabled();
        const fuzzyBlockingEnabled = getFuzzyBlockingEnabled();
        const blockedGroups = groupBlockingEnabled
            ? Object.keys(getBlockedGroups() || {})
            : [];
        const blockedGroupsData = groupBlockingEnabled
            ? getBlockedGroups()
            : {};
        const collectedChapters = new Set<string>();
        const chapters: Chapter[] = [];

        let latestChapter: { id: string; createdAt: Date } | null = null;
        let offset = 0;
        let sortingIndex = 0;
        let hasResults = true;
        let prevChapNum = 0;
        while (hasResults) {
            const request = {
                url: new URL(MANGADEX_API)
                    .addPathComponent("manga")
                    .addPathComponent(mangaId)
                    .addPathComponent("feed")
                    .setQueryItem("limit", "500")
                    .setQueryItem("offset", offset.toString())
                    .setQueryItem("includes[]", "scanlation_group")
                    .setQueryItem(
                        "excludedGroups[]",
                        blockedGroups.length > 0 ? blockedGroups : [],
                    )
                    .setQueryItem("order[volume]", "desc")
                    .setQueryItem("order[chapter]", "desc")
                    .setQueryItem("order[createdAt]", "desc")
                    .setQueryItem("contentRating[]", ratings)
                    .setQueryItem("includeFutureUpdates", "0")
                    .setQueryItem("includeEmptyPages", "0")
                    .toString(),
                method: "GET",
            };

            const json = await fetchJSON<MangaDex.ChapterResponse>(request);

            offset += 500;

            if (json.data === undefined)
                throw new Error(`Failed to create chapters for ${mangaId}`);

            for (const chapter of json.data) {
                const chapterId = chapter.id;
                const chapterDetails = chapter.attributes;
                const time = new Date(chapterDetails.publishAt);
                const createdAt = new Date(chapterDetails.createdAt);

                if (!latestChapter || createdAt > latestChapter.createdAt) {
                    latestChapter = {
                        id: chapterId,
                        createdAt: createdAt,
                    };

                    sourceManga.mangaInfo.additionalInfo = {
                        latestUploadedChapter: chapterId,
                    };
                }

                if (!languages.includes(chapterDetails.translatedLanguage)) {
                    continue;
                }

                const name =
                    Application.decodeHTMLEntities(
                        chapterDetails.title ?? "",
                    ) ?? "";
                let chapNum = Number(chapterDetails.chapter);
                if (isNaN(chapNum)) {
                    chapNum = prevChapNum - 0.001;
                } else {
                    prevChapNum = chapNum;
                }

                const volume = Number(chapterDetails.volume);
                const langCode = MDLanguages.getFlagCode(
                    chapterDetails.translatedLanguage,
                );
                const group = chapter.relationships
                    .filter(
                        (x: MangaDex.ChapterRelationship) =>
                            x.type.valueOf() === "scanlation_group",
                    )
                    .map(
                        (x: MangaDex.ChapterRelationship) => x.attributes?.name,
                    )
                    .join(", ");
                const pages = Number(chapterDetails.pages);
                const identifier = `${volume}-${chapNum}-${chapterDetails.translatedLanguage}`;

                if (collectedChapters.has(identifier) && skipSameChapter)
                    continue;

                if (groupBlockingEnabled && fuzzyBlockingEnabled && group) {
                    let shouldSkip = false;

                    for (const blockedGroupId of blockedGroups) {
                        const blockedGroupName =
                            blockedGroupsData[blockedGroupId]?.attributes?.name;
                        if (blockedGroupName && group) {
                            const score = relevanceScore(
                                group,
                                blockedGroupName,
                            );
                            if (score >= 70) {
                                shouldSkip = true;
                                break;
                            }
                        }
                    }

                    if (shouldSkip) continue;
                }

                if (pages > 0) {
                    chapters.push({
                        chapterId,
                        sourceManga,
                        title: name,
                        chapNum,
                        volume,
                        langCode,
                        version: group,
                        publishDate: time,
                        sortingIndex,
                    });
                    collectedChapters.add(identifier);
                    sortingIndex--;
                }
            }

            if (json.total <= offset) {
                hasResults = false;
            }
        }

        if (chapters.length == 0) {
            throw new Error(
                `Couldn't find any chapters in your selected language for mangaId: ${mangaId}!`,
            );
        }

        return chapters.map((chapter) => {
            chapter.sortingIndex =
                (chapter.sortingIndex ?? 0) + chapters.length;
            return chapter;
        });
    }

    /**
     * Gets page details for a specific chapter
     */
    async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
        const chapterId = chapter.chapterId;
        const mangaId = chapter.sourceManga.mangaId;

        checkId(chapterId);

        const dataSaver = getDataSaver();
        const forcePort = getForcePort443();

        const request = {
            url: `${MANGADEX_API}/at-home/server/${chapterId}${forcePort ? "?forcePort443=true" : ""}`,
            method: "GET",
        };

        const json = await fetchJSON<MangaDex.ChapterDetailsResponse>(request);
        const serverUrl = json.baseUrl;
        const chapterDetails = json.chapter;

        let pages: string[];
        if (dataSaver) {
            pages = chapterDetails.dataSaver.map(
                (x: string) =>
                    `${serverUrl}/data-saver/${chapterDetails.hash}/${x}`,
            );
        } else {
            pages = chapterDetails.data.map(
                (x: string) => `${serverUrl}/data/${chapterDetails.hash}/${x}`,
            );
        }

        return { id: chapterId, mangaId: mangaId, pages };
    }

    /**
     * Optimizes update process by filtering which manga need updates
     */
    async processTitlesForUpdates(updateManager: UpdateManager): Promise<void> {
        const sourceManga = updateManager.getQueuedItems();

        const mangaMap = new Map<string, SourceManga>();
        const mangaIds: string[] = [];
        for (const manga of sourceManga) {
            checkId(manga.mangaId);
            mangaIds.push(manga.mangaId);
            mangaMap.set(manga.mangaId, manga);
        }

        const optimizeUpdates = getOptimizeUpdates();

        if (optimizeUpdates) {
            const ratings: string[] = getRatings();
            const languages: string[] = getLanguages();
            const skipPublicationStatus = getSkipPublicationStatus();
            const batchSize = getUpdateBatchSize();
            const skipNewChapters = getSkipNewChapters();
            const skipUnreadChapters = getSkipUnreadChapters();

            for (let i = 0; i < mangaIds.length; i += batchSize) {
                const batchIds = mangaIds.slice(i, i + batchSize);
                const offset: number = 0;
                const needsUpdate: string[] = []; // Processed by default, but keep in case we can do something later
                const skipUpdate: string[] = [];

                const request = {
                    url: new URL(MANGADEX_API)
                        .addPathComponent("manga")
                        .setQueryItem("limit", batchSize.toString())
                        .setQueryItem(
                            "availableTranslatedLanguage[]",
                            languages,
                        )
                        .setQueryItem("offset", offset.toString())
                        .setQueryItem("contentRating[]", ratings)
                        .setQueryItem("ids[]", batchIds)
                        .toString(),
                    method: "GET",
                };

                const json = await fetchJSON<MangaDex.SearchResponse>(request);

                if (json.data) {
                    for (const mangaData of json.data) {
                        const sourceManga = mangaMap.get(mangaData.id);
                        if (!sourceManga) continue;

                        const latestApiChapter =
                            mangaData.attributes.latestUploadedChapter;
                        const latestStoredChapter =
                            sourceManga.mangaInfo?.additionalInfo
                                ?.latestUploadedChapter;

                        let skipUnread = false;
                        if (
                            skipUnreadChapters > 0 &&
                            sourceManga.unreadChapterCount !== undefined &&
                            sourceManga.chapterCount
                        ) {
                            if (skipUnreadChapters === 1) {
                                skipUnread = sourceManga.unreadChapterCount > 0;
                            } else {
                                const unreadPercentage =
                                    (sourceManga.unreadChapterCount /
                                        sourceManga.chapterCount) *
                                    100;
                                skipUnread =
                                    unreadPercentage >= skipUnreadChapters;
                            }
                        }

                        let skipNew = false;
                        if (
                            skipNewChapters > 0 &&
                            sourceManga.newChapterCount !== undefined &&
                            sourceManga.chapterCount
                        ) {
                            if (skipNewChapters === 1) {
                                skipNew = sourceManga.newChapterCount > 0;
                            } else {
                                const newPercentage =
                                    (sourceManga.newChapterCount /
                                        sourceManga.chapterCount) *
                                    100;
                                skipNew = newPercentage >= skipNewChapters;
                            }
                        }

                        if (
                            latestApiChapter &&
                            latestApiChapter !== latestStoredChapter &&
                            !skipPublicationStatus.includes(
                                mangaData.attributes.status,
                            ) &&
                            !skipUnread &&
                            !skipNew
                        ) {
                            needsUpdate.push(mangaData.id);
                        } else {
                            skipUpdate.push(mangaData.id);
                        }
                    }
                }

                for (const mangaId of skipUpdate) {
                    await updateManager.setNewChapters(mangaId, []);
                }
            }
        }
    }
}
