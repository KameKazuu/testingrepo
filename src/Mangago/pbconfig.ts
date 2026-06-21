/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "Mangago",
  description: "Extension that pulls content from mangago.me.",
  version: "1.0.0-alpha.1",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.MATURE,
  capabilities: [
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
  ],
  badges: [
    {
      label: "Aggregator",
      textColor: "#FFFFFF",
      backgroundColor: "#800080",
    },
    {
      label: "Mature",
      textColor: "#FFFFFF",
      backgroundColor: "#800080",
    },
  ],
  developers: [
    {
      name: "popbase85-collab",
      github: "https://github.com/popbase85-collab",
    },
  ],
} satisfies ExtensionInfo;

