import { ContentRating, type ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "Mangago",
  description: "Extension for Mangago.",
  version: "1.0.0",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.MATURE,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.MANGA_CHAPTERS_PROVIDING,
    SourceIntents.CHAPTER_DETAILS_PROVIDING,
  ],
  developers: [
    {
      name: "popbase85-collab",
    },
  ],
} satisfies ExtensionInfo;
