import { ContentRating, SearchQuery, SourceManga, Tag } from "@paperback/types";
import { MDImageQuality } from "./MangaDexHelper";
import {
    getCustomCoversEnabled,
    getMangaThumbnail,
    getRelevanceScoringEnabled,
    getSelectedCover,
    getShowChapter,
    getShowRatingIcons,
    getShowStatusIcons,
    getShowVolume,
} from "./MangaDexSettings";
import { COVER_BASE_URL, MANGADEX_DOMAIN } from "./utils/CommonUtil";
import { relevanceScore } from "./utils/titleRelevanceScore";

// Type for manga item with additional processing
type MangaItemWithAdditionalInfo = MangaDex.MangaItem & {
    mangaId: string;
    title: string;
    imageUrl: string;
    subtitle?: string;
};

// Maps MangaDex content ratings to Paperback content ratings
export const contentRatingMap: Record<string, ContentRating> = {
    safe: ContentRating.EVERYONE,
    suggestive: ContentRating.MATURE,
    erotica: ContentRating.ADULT,
    pornographic: ContentRating.ADULT,
};

// Icons for manga status display
const statusIconMap: Record<string, string> = {
    completed: "✅",
    ongoing: "▶️",
    hiatus: "⏸️",
    cancelled: "❌",
};

// Icons for content rating display
const ratingIconMap: Record<string, string> = {
    safe: "🟢",
    suggestive: "🟡",
    erotica: "🟠",
    pornographic: "🔞",
};

/**
 * Parses manga list from API response and formats for display
 * Handles relevance sorting and thumbnail formatting
 */
export const parseMangaList = async (
    object: MangaDex.MangaItem[],
    thumbnailSelector: () => string,
    query?: SearchQuery,
): Promise<MangaItemWithAdditionalInfo[]> => {
    const results: { manga: MangaItemWithAdditionalInfo; relevance: number }[] =
        [];

    const thumbnailQuality = thumbnailSelector();
    const useCustomCovers = getCustomCoversEnabled();

    for (const manga of object) {
        const mangaId = manga.id;
        const mangaDetails = manga.attributes;
        const title =
            Application.decodeHTMLEntities(
                mangaDetails.title.en ??
                    mangaDetails.altTitles
                        .flatMap(
                            (x: MangaDex.AltTitle) =>
                                Object.values(x) as string[],
                        )
                        .find(
                            (t: string | undefined): t is string =>
                                t !== undefined,
                        ),
            ) ?? "Unknown Title";

        let coverFileName = manga.relationships
            .filter(
                (x): x is MangaDex.Relationship =>
                    x.type.valueOf() === "cover_art",
            )
            .map((x) => x.attributes?.fileName)[0];

        if (useCustomCovers) {
            const customCover = getSelectedCover(mangaId);
            if (customCover?.fileName) {
                coverFileName = customCover.fileName;
            }
        }

        const image = coverFileName
            ? `${COVER_BASE_URL}/${mangaId}/${coverFileName}${MDImageQuality.getEnding(thumbnailQuality)}`
            : `${MANGADEX_DOMAIN}/_nuxt/img/cover-placeholder.d12c3c5.jpg`;

        const showStatusIcons = getShowStatusIcons();
        const showRatingIcons = getShowRatingIcons();

        const statusIcon = showStatusIcons
            ? statusIconMap[mangaDetails.status.toLowerCase()] || ""
            : "";
        const ratingIcon = showRatingIcons
            ? ratingIconMap[mangaDetails.contentRating.toLowerCase()] || ""
            : "";

        const chapterInfo = parseChapterTitle({
            title: undefined,
            volume: mangaDetails.lastVolume,
            chapter: mangaDetails.lastChapter,
        });

        const subtitle =
            `${ratingIcon}${statusIcon}${statusIcon || ratingIcon ? " " : ""}${chapterInfo}`.trim();

        let relevance = 0;
        if (query?.title && getRelevanceScoringEnabled()) {
            // Score primary title
            relevance = relevanceScore(title, query.title);

            // Score all alternative titles and take the max
            const altTitles: string[] =
                mangaDetails.altTitles
                    ?.flatMap(
                        (x: MangaDex.AltTitle) => Object.values(x) as string[],
                    )
                    .map((x: string) => Application.decodeHTMLEntities(x)) ||
                [];
            for (const alt of altTitles) {
                const altScore = relevanceScore(alt, query.title);
                if (altScore > relevance) {
                    relevance = altScore;
                }
            }
        }

        results.push({
            manga: {
                ...manga,
                mangaId: mangaId,
                title: title,
                imageUrl: image,
                subtitle: subtitle,
            },
            relevance: relevance,
        });
    }

    if (query?.title && getRelevanceScoringEnabled()) {
        results.sort((a, b) => b.relevance - a.relevance);
    }
    return results.map((r) => r.manga);
};

/**
 * Parses detailed manga information from API response
 */
export const parseMangaDetails = (
    mangaId: string,
    json: MangaDex.MangaDetailsResponse,
    ratingJson?: MangaDex.StatisticsResponse,
    coversJson?: MangaDex.CoverArtResponse,
): SourceManga => {
    const mangaDetails: MangaDex.DatumAttributes = json.data.attributes;

    const secondaryTitles: string[] = mangaDetails.altTitles
        .flatMap((x: MangaDex.AltTitle) => Object.values(x) as string[])
        .map((x: string) => Application.decodeHTMLEntities(x));
    const primaryTitle: string =
        mangaDetails.title.en ??
        (Object.values(mangaDetails.title) as string[])[0];
    const desc = (mangaDetails.description.en ?? "")?.replace(
        /\[\/?[bus]]/g,
        "",
    );

    const status = mangaDetails.status;

    const tags: Tag[] = mangaDetails.tags
        .map((tag) => ({
            id: tag.id,
            title: tag.attributes.name.en ?? "Unknown",
        }))
        .sort((a, b) => a.title.localeCompare(b.title));

    const author = json.data.relationships
        .filter(
            (x): x is MangaDex.Relationship => x.type.valueOf() === "author",
        )
        .map((x) => x.attributes?.name)
        .filter(Boolean)
        .join(", ");
    const artist = json.data.relationships
        .filter(
            (x): x is MangaDex.Relationship => x.type.valueOf() === "artist",
        )
        .map((x) => x.attributes?.name)
        .filter(Boolean)
        .join(", ");

    let image = "";

    let coverFileName = json.data.relationships
        .filter(
            (x): x is MangaDex.Relationship => x.type.valueOf() === "cover_art",
        )
        .map((x) => x.attributes?.fileName)[0];

    if (getCustomCoversEnabled()) {
        const customCover = getSelectedCover(mangaId);
        if (customCover?.fileName) {
            coverFileName = customCover.fileName;
        }
    }

    if (coverFileName) {
        image = `${COVER_BASE_URL}/${mangaId}/${coverFileName}${MDImageQuality.getEnding(getMangaThumbnail())}`;
    }

    const rating = ratingJson?.statistics?.[mangaId]?.rating?.average
        ? ratingJson.statistics[mangaId].rating.average / 10
        : undefined;

    const artworkUrls: string[] = [];
    if (coversJson?.result === "ok" && coversJson.data) {
        for (const cover of coversJson.data) {
            if (cover.attributes.fileName) {
                artworkUrls.push(
                    `${COVER_BASE_URL}/${mangaId}/${cover.attributes.fileName}`,
                );
            }
        }
    }

    return {
        mangaId: mangaId,
        mangaInfo: {
            primaryTitle,
            secondaryTitles,
            thumbnailUrl: image,
            author,
            artist,
            synopsis: desc ?? "No Description",
            status,
            tagGroups: [{ id: "tags", title: "Tags", tags }],
            contentRating:
                contentRatingMap[
                    (mangaDetails.contentRating as string)?.toLowerCase() ?? ""
                ] ?? ContentRating.EVERYONE,
            shareUrl: `${MANGADEX_DOMAIN}/title/${mangaId}`,
            rating,
            artworkUrls: artworkUrls.length > 0 ? artworkUrls : undefined,
        },
    };
};

/**
 * Formats chapter title with volume and chapter numbers based on settings
 */
export function parseChapterTitle(
    attributes: Partial<MangaDex.ChapterAttributes>,
): string {
    const title = attributes.title?.trim() || "";
    const showVolume = getShowVolume();
    const showChapter = getShowChapter();

    const volume =
        showVolume && attributes.volume ? `Vol. ${attributes.volume} ` : "";
    const chapter =
        showChapter && attributes.chapter ? `Ch. ${attributes.chapter}` : "";

    return `${volume}${chapter}${title ? ` - ${title}` : ""}`.trim();
}
