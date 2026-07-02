/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type {
  DiscoverSectionItem,
  FeaturedCarouselItem,
  SimpleCarouselItem,
} from "@paperback/types";
import { ContentRating } from "@paperback/types";

import type { HiveScansPost, HiveScansSearchResponse } from "../shared/models";
import { encodeMangaId, formatSeriesSubtitle, isNovel } from "../shared/utils";

function parseFeaturedItems(posts: HiveScansPost[]): FeaturedCarouselItem[] {
  return posts
    .filter((post) => !isNovel(post))
    .map((post) => ({
      type: "featuredCarouselItem" as const,
      mangaId: encodeMangaId(post.slug),
      title: Application.decodeHTMLEntities(post.postTitle),
      imageUrl: post.featuredImage ?? "",
      supertitle: formatSeriesSubtitle(post.seriesType, post.seriesStatus),
      contentRating: ContentRating.EVERYONE,
    }));
}

function parseSimpleItems(posts: HiveScansPost[]): SimpleCarouselItem[] {
  return posts
    .filter((post) => !isNovel(post))
    .map((post) => ({
      type: "simpleCarouselItem" as const,
      mangaId: encodeMangaId(post.slug),
      title: Application.decodeHTMLEntities(post.postTitle),
      imageUrl: post.featuredImage ?? "",
      subtitle: formatSeriesSubtitle(post.seriesType, post.seriesStatus),
      contentRating: ContentRating.EVERYONE,
    }));
}

export function parseDiscoverItems(
  data: HiveScansSearchResponse,
  sectionId: string,
): DiscoverSectionItem[] {
  switch (sectionId) {
    case "popular":
      return parseFeaturedItems(data.posts ?? []);
    case "latest":
      return parseSimpleItems(data.posts ?? []);
    default:
      return [];
  }
}
