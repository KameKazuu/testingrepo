/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ContentRating, type ExtensionInfo, SourceIntents } from "@paperback/types";

export default {
  name: "MangaBaka",
  description:
    "Extension that integrates with mangabaka.org for tracking and collection management.",
  version: "1.0.0-alpha.17",
  icon: "icon.png",
  language: "en",
  // The database covers every rating and the discover and search endpoints are
  // unfiltered by default, so suggestive and adult titles can appear.
  contentRating: ContentRating.MATURE,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.PROGRESS_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
  ],
  badges: [],
  developers: [
    {
      name: "PoppingMango",
      github: "https://github.com/PoppingMango",
    },
  ],
} as ExtensionInfo;
