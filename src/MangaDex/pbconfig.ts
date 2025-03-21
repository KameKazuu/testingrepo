import { ContentRating, SourceInfo, SourceIntents } from "@paperback/types";

/**
 * Extension metadata and configuration
 * Defines capabilities, version, and other information
 */
export default {
    name: "MangaDex",
    description: "Extension that pulls content from mangadex.org.",
    version: "1.0.0-alpha.9",
    icon: "icon.png",
    languages: "multi",
    contentRating: ContentRating.EVERYONE,
    capabilities: [
        SourceIntents.COLLECTION_MANAGEMENT,
        SourceIntents.MANGA_CHAPTERS,
        SourceIntents.DISCOVER_SECIONS,
        SourceIntents.MANGA_SEARCH,
        SourceIntents.SETTINGS_UI,
        SourceIntents.MANGA_PROGRESS,
    ],
    badges: [],
    developers: [
        {
            name: "Paperback Community",
            website: "https://github.com/paperback-community",
        },
    ],
} as SourceInfo;
