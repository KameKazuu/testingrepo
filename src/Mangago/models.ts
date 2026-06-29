export const DOMAIN = "https://www.mangago.me";

// mangago serves a chapter list in one of two reader formats:
//   • the read-manga reader  — URLs like /read-manga/<slug>/.../pg-N/, served by
//     www.mangago.me. Loads the whole chapter from one host (no mirror, no
//     cross-origin redirects) — what keiyoushi and Aidoku use.
//   • the legacy numeric reader — URLs like /chapter/<mid>/<cid>/, served ONLY by
//     the mirror hosts (READER_MIRROR / READER_MIRROR_FALLBACK). These 404 on
//     www.mangago.me and are windowed (one ~5-image slice per page), which is the
//     source of the "only 5 pages" problem.
// The manga-page User-Agent influences which format the chapter list comes back
// in (a mobile UA tends to yield read-manga URLs, a desktop UA the numeric ones),
// so the chapter-list UA is exposed as a user setting (getChapterListUserAgentMode).
// Reader pages themselves keep the desktop UA. Each reader path is still routed to
// a host that actually serves it (canonicalReaderUrl in utils.ts), and a numeric
// entry is opportunistically upgraded to read-manga (resolveReadMangaChapterUrl in
// main.ts).
export const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

// A mobile iPhone UA. mangago serves the chapter list as read-manga reader URLs
// (/read-manga/<slug>/.../pg-N/ — served by www.mangago.me and fully loadable in
// one host with no windowed-mirror redirects) to a MOBILE client, but as legacy
// numeric URLs (/chapter/<mid>/<cid>/ — windowed, mirror-only, the source of the
// "only 5 pages" problem) to a desktop one. The reader pages themselves keep the
// desktop UA. Exposed as a user setting (see getChapterListUserAgentMode).
export const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

export const CHAPTER_LIST_USER_AGENT_OPTIONS = [
  { id: "desktop", title: "Desktop (numeric reader)" },
  { id: "mobile", title: "Mobile (read-manga reader)" },
] as const;

const CHAPTER_LIST_USER_AGENT_STATE_KEY = "mangago_chapter_list_user_agent";

// Which UA to send for the manga page / chapter-list fetch. Desktop (default)
// preserves current behaviour; mobile makes chapters resolve to the read-manga
// reader, which avoids the windowed-numeric-reader mirror issues.
export function getChapterListUserAgentMode(): "desktop" | "mobile" {
  return Application.getState(CHAPTER_LIST_USER_AGENT_STATE_KEY) === "mobile"
    ? "mobile"
    : "desktop";
}

export function setChapterListUserAgentMode(mode: string): void {
  Application.setState(mode === "mobile" ? "mobile" : "desktop", CHAPTER_LIST_USER_AGENT_STATE_KEY);
}

// Reader mirrors that serve the legacy numeric /chapter/<mid>/<cid>/ reader.
// www.mangago.me 404s those paths; these hosts return them (windowed). The site
// rotates chapter links across both of these plus www.mangago.me.
export const READER_MIRROR = "https://www.mangago.zone";
export const READER_MIRROR_FALLBACK = "https://www.youhim.me";

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
