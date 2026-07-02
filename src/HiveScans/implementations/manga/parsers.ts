/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { SourceManga } from "@paperback/types";
import { ContentRating } from "@paperback/types";

import type { HiveScansPost } from "../shared/models";
import { DOMAIN } from "../shared/models";
import { cleanField, encodeMangaId, mapStatus, stripHtml } from "../shared/utils";

function seriesTypeTag(seriesType?: string | null): string | undefined {
  switch ((seriesType ?? "").toUpperCase()) {
    case "MANGA":
      return "Manga";
    case "MANHUA":
      return "Manhua";
    case "MANHWA":
      return "Manhwa";
    default:
      return undefined;
  }
}

export function parseMangaDetails(post: HiveScansPost): SourceManga {
  const genreNames = [
    seriesTypeTag(post.seriesType),
    ...(post.genres ?? []).map((genre) => genre.name),
  ].filter((name): name is string => Boolean(name));
  const uniqueGenres = [...new Set(genreNames)];

  const secondaryTitles = post.alternativeTitles
    ? post.alternativeTitles
        .split(/[,\n]/)
        .map((title) => title.trim())
        .filter((title) => title.length > 0)
    : [];

  return {
    mangaId: encodeMangaId(post.slug),
    mangaInfo: {
      primaryTitle: Application.decodeHTMLEntities(post.postTitle),
      secondaryTitles,
      thumbnailUrl: post.featuredImage ?? "",
      synopsis: stripHtml(post.postContent ?? ""),
      author: cleanField(post.author),
      artist: cleanField(post.artist),
      status: mapStatus(post.seriesStatus),
      contentRating: ContentRating.EVERYONE,
      tagGroups:
        uniqueGenres.length > 0
          ? [
              {
                id: "genres",
                title: "Genres",
                tags: uniqueGenres.map((name) => ({
                  id: name.toLowerCase().replace(/\s+/g, "-"),
                  title: name,
                })),
              },
            ]
          : [],
      additionalInfo: {
        slug: post.slug,
      },
      shareUrl: `${DOMAIN}/series/${post.slug}`,
    },
  };
}
