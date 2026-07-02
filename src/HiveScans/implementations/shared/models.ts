/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

// HiveScans (hivetoons.org) runs on the "Iken" platform, the same JSON API
// shared by several manga/manhwa sites (see keiyoushi's `lib-multisrc/iken`).

export const DOMAIN = "https://hivetoons.org";
export const DOMAIN_API = "https://api.hivetoons.org/api";

export const PAGE_SIZE = 18;

export interface HiveScansGenre {
  id: number;
  name: string;
}

export interface HiveScansPost {
  id: number;
  slug: string;
  postTitle: string;
  postContent?: string | null;
  isNovel?: boolean;
  featuredImage?: string | null;
  alternativeTitles?: string | null;
  author?: string | null;
  artist?: string | null;
  seriesType?: string | null;
  seriesStatus?: string | null;
  genres?: HiveScansGenre[];
}

export interface HiveScansSearchResponse {
  posts: HiveScansPost[];
  totalCount: number;
}

export interface HiveScansChapter {
  id: number;
  slug: string;
  number: number | string;
  title?: string | null;
  createdAt: string;
  chapterStatus: string;
  isAccessible: boolean;
  isLocked?: boolean;
  isTimeLocked?: boolean;
}

export interface HiveScansPostDetails extends HiveScansPost {
  chapters: HiveScansChapter[];
}

export interface HiveScansPostDetailsResponse {
  post: HiveScansPostDetails;
}

export interface HiveScansPageImage {
  url: string;
  order?: number | null;
}

export interface HiveScansPage {
  images: HiveScansPageImage[];
  isPermanentlyLocked?: boolean;
  isLockedByCoins?: boolean;
  isShortLinkLocked?: boolean;
}

// The `/api/chapter` endpoint wraps the page data in a `chapter` envelope.
export interface HiveScansChapterResponse {
  chapter?: HiveScansPage;
}

export type Metadata = {
  page?: number;
};
