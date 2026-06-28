export const DOMAIN = "https://www.mangago.me";

export const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

// Mangago serves DIFFERENT chapter URLs depending on the user-agent:
//   - desktop UA  -> the legacy numeric reader (/chapter/<mid>/<cid>/), which
//     www.mangago.me now 404s (it only lives on the old .zone mirror, windowed).
//   - mobile UA   -> the read-manga reader (/read-manga/<slug>/uu/<chapter>/pg-N/),
//     which www.mangago.me serves directly and completely.
// keiyoushi/Tachimanga use a mobile UA for everything and get the read-manga
// reader; Aidoku confirms the read-manga reader is the one that works. So we
// fetch the catalog (manga page / chapter list) with the mobile UA to obtain
// read-manga chapter URLs. The reader pages and scrambled images are still
// requested with the desktop UA, which returns the COMPLETE read-manga page in
// one shot (Aidoku's behaviour) instead of a mobile-windowed slice.
export const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1";

export type MangagoSearchMetadata = {
  page?: number;
  genre?: string;
  genres?: Record<string, "included" | "excluded">;
  statuses?: string[];
};

export type MangagoGenreOption = {
  id: string;
  title: string;
};

export const STATUS_OPTIONS = [
  {
    id: "f",
    label: "Completed",
  },
  {
    id: "o",
    label: "Ongoing",
  },
] as const;

export const SORT_OPTIONS = [
  {
    id: "alphabetical",
    label: "Alphabetical",
    value: undefined,
  },
  {
    id: "views",
    label: "Views",
    value: "view",
  },
  {
    id: "popularity",
    label: "Popularity",
    value: "comment_count",
  },
  {
    id: "create_date",
    label: "Create Date",
    value: "create_date",
  },
  {
    id: "update_date",
    label: "Update Date",
    value: "update_date",
  },
] as const;

export const GENRES = [
  "Yaoi",
  "Comedy",
  "Shounen Ai",
  "Shoujo",
  "Yuri",
  "Josei",
  "Fantasy",
  "School Life",
  "Romance",
  "Doujinshi",
  "Smut",
  "Adult",
  "Mystery",
  "One Shot",
  "Ecchi",
  "Shounen",
  "Martial Arts",
  "Shoujo Ai",
  "Supernatural",
  "Drama",
  "Action",
  "Adventure",
  "Harem",
  "Historical",
  "Horror",
  "Mature",
  "Mecha",
  "Psychological",
  "Sci-fi",
  "Seinen",
  "Slice Of Life",
  "Sports",
  "Gender Bender",
  "Tragedy",
  "Bara",
  "Webtoons",
];

export function genreIdFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export const GENRE_OPTIONS: MangagoGenreOption[] = GENRES.map((genre) => ({
  id: genreIdFromTitle(genre),
  title: genre,
}));

export function getGenreTitle(idOrTitle: string): string {
  return (
    GENRE_OPTIONS.find((genre) => genre.id === idOrTitle || genre.title === idOrTitle)?.title ??
    idOrTitle
  );
}

export type MangagoImageContext = {
  desckey: string;
  cols: number;
};

export const DISCOVER_SECTION_OPTIONS = [
  { id: "featured_manga", title: "Featured Manga" },
  { id: "new_chapters", title: "New Chapters" },
  { id: "popular_manga", title: "Popular Manga" },
  { id: "top_yaoi", title: "Yaoi Manga Top 5" },
  { id: "top_comedy", title: "Comedy Manga Top 5" },
  { id: "top_shounen_ai", title: "Shounen Ai Manga Top 5" },
  { id: "top_shoujo", title: "Shoujo Manga Top 5" },
  { id: "top_yuri", title: "Yuri Manga Top 5" },
  { id: "top_josei", title: "Josei Manga Top 5" },
  { id: "top_fantasy", title: "Fantasy Manga Top 5" },
  { id: "top_school_life", title: "School Life Manga Top 5" },
  { id: "top_supernatural", title: "Supernatural Manga Top 5" },
  { id: "top_mystery", title: "Mystery Manga Top 10" },
  { id: "genres", title: "Genres" },
] as const;

function discoverSectionStateKey(sectionId: string): string {
  return `mangago_discover_section_${sectionId}`;
}

export function getDiscoverSectionEnabled(sectionId: string): boolean {
  return (Application.getState(discoverSectionStateKey(sectionId)) as boolean | undefined) ?? true;
}

export function setDiscoverSectionEnabled(sectionId: string, enabled: boolean): void {
  Application.setState(enabled, discoverSectionStateKey(sectionId));
}

export function resetDiscoverSectionSettings(): void {
  for (const section of DISCOVER_SECTION_OPTIONS) {
    Application.setState(undefined, discoverSectionStateKey(section.id));
  }
}
