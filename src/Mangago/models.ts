export const DOMAIN = "https://www.mangago.me";

// mangago needs TWO different User-Agents, exactly like the working Aidoku
// source (confirmed from its live request logs):
//
//   • Browsing UA (mobile iPhone) — used for the manga listing, search, discover
//     and, crucially, the manga-details / chapter-list page. With a MOBILE UA the
//     details page lists chapters as read-manga URLs (/read-manga/<slug>/uu/...);
//     with a desktop UA it lists them as the legacy numeric /chapter/<mid>/<cid>/
//     reader, which www.mangago.me 404s (the "no usable chapter page" failure).
//   • Reader UA (desktop macOS Chrome) — used for the reader page itself, together
//     with the _m_superu=1 cookie. This is the exact pair Aidoku hard-codes on its
//     page-list request; it makes the read-manga reader return the COMPLETE image
//     list in one request (_multimode = ""), fixing the "only 5 pages" chapters.
//
// readerHeadersForUrl() in network.ts picks between them per request URL.
export const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

export const READER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

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
