import { ContentRating, SourceInfo, SourceIntents } from "@paperback/types";

export default {
    name: "MangaFire",
    description: "Extension that pulls content from mangafire.to.",
    version: "1.0.0-alpha.4",
    icon: "icon.png",
    language: "en",
    contentRating: ContentRating.EVERYONE,
    capabilities: [
        SourceIntents.DISCOVER_SECIONS,
        SourceIntents.MANGA_SEARCH,
        SourceIntents.MANGA_CHAPTERS,
    ],
    badges: [],
    developers: [
        {
            name: "Karrot",
        },
        {
            name: "nyzzik",
        },
    ],
} satisfies SourceInfo;
