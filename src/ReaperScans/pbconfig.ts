import { ContentRating, SourceInfo, SourceIntents } from "@paperback/types";

export default {
    name: "ReaperScans",
    description: "Extension that pulls content from reaperscans.com.",
    version: "1.0.0-alpha.2",
    icon: "icon.png",
    language: "en",
    contentRating: ContentRating.EVERYONE,
    capabilities: [
        SourceIntents.MANGA_CHAPTERS,
        SourceIntents.DISCOVER_SECIONS,
        SourceIntents.MANGA_SEARCH,
    ],
    badges: [],
    developers: [
        {
            name: "nyzzik",
            github: "https://github.com/nyzzik",
        },
    ],
} satisfies SourceInfo;
