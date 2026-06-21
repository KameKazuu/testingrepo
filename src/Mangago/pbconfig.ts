import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "Mangago",
  description: "Mangago source for Paperback.",
  version: "1.0.0",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.MATURE,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
  ],
  badges: [],
  developers: [
    {
      name: "Popbase85",
      github: "https://github.com/popbase85-collab",
    },
  ],
} satisfies ExtensionInfo;
