import { ContentRating, SourceInfo, SourceIntents } from "@paperback/types";

export default {
  name: "RawKuma",
  description: "Extension that pulls content from rawkuma.com.",
  version: "1.0.0-alpha.1",
  icon: "icon.png",
  language: "jp",
  contentRating: ContentRating.EVERYONE,
  badges: [
    { label: "RAW PROVIDER", textColor: "#FFFFFF", backgroundColor: "#800080" },
  ],
  capabilities: [
    SourceIntents.DISCOVER_SECIONS,
    SourceIntents.MANGA_SEARCH,
    SourceIntents.MANGA_CHAPTERS,
  ],
  developers: [
    {
      name: "Karrot",
    },
  ],
} satisfies SourceInfo;
