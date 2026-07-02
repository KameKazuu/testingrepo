/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export const DOMAIN = "https://rinkocomics.com";

// WordPress "comicworld" theme AJAX endpoint used to lazily load chapters.
export const AJAX_ENDPOINT = `${DOMAIN}/wp-admin/admin-ajax.php`;

// Locked chapters are tagged with this suffix on their id so getChapterDetails
// can short-circuit before making a doomed request.
export const LOCK_SUFFIX = "#lock";
export const LOCK_PREFIX = "🔒 ";

// The theme paginates the chapter list 10 at a time behind "load more".
export const CHAPTERS_PER_PAGE = 10;

export const CHAPTER_SELECTOR = "li.chapter";

// Extracts the WordPress nonce embedded in the inline `comicworld_ajax` object.
export const NONCE_REGEX = /comicworld_ajax\s*=\s*\{[^}]*"nonce"\s*:\s*"([^"]+)"/;

export type PageMetadata = {
  page?: number;
};

export type SearchMetadata = {
  // slug -> included (this theme only supports inclusive genre filtering)
  genres?: { [slug: string]: "included" };
};

export type ComicCard = {
  mangaId: string;
  title: string;
  imageUrl: string;
};

export type Genre = {
  slug: string;
  name: string;
};

// Shape of the admin-ajax `load_more_chapters` response.
export type AjaxChapterResponse = {
  success?: boolean;
  data?: {
    html?: string;
  };
};
