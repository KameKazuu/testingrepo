export const DOMAIN = "https://www.mangago.me";

// The default User-Agent for every mangago request. A desktop Chrome UA — the
// same one keiyoushi and Aidoku send. Cloudflare binds the cf_clearance cookie
// to the UA that solved the challenge, so the UA must stay consistent across the
// manga page, chapter list and reader fetches. The UA is user-selectable
// (USER_AGENT_OPTIONS / getSelectedUserAgent) so a reader can switch presets if
// Cloudflare rejects the default one for them; the default preserves current
// behaviour.
export const DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

// User-selectable User-Agent presets, exposed in the settings form. The first
// entry (Chrome on macOS) is the default and matches DESKTOP_USER_AGENT, so the
// behaviour is unchanged unless the reader picks another preset. The presets give
// a way to work around Cloudflare rejecting a particular UA (cf_clearance is
// bound to the UA that solved the challenge), mirroring how keiyoushi's Mihon app
// lets the user choose a custom UA.
export const USER_AGENT_OPTIONS = [
  {
    id: "chrome_macos",
    title: "Chrome (macOS)",
    value: DESKTOP_USER_AGENT,
  },
  {
    id: "chrome_windows",
    title: "Chrome (Windows)",
    value:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
  },
  {
    id: "safari_macos",
    title: "Safari (macOS)",
    value:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  },
  {
    id: "firefox_windows",
    title: "Firefox (Windows)",
    value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
  },
  {
    id: "safari_iphone",
    title: "Safari (iPhone)",
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  },
  {
    id: "chrome_android",
    title: "Chrome (Android)",
    value:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36",
  },
] as const;

const USER_AGENT_STATE_KEY = "mangago_user_agent";

// The id of the currently selected User-Agent preset (defaults to the first one).
export function getSelectedUserAgentId(): string {
  const stored = Application.getState(USER_AGENT_STATE_KEY) as string | undefined;
  if (stored && USER_AGENT_OPTIONS.some((option) => option.id === stored)) return stored;
  return USER_AGENT_OPTIONS[0].id;
}

// The User-Agent string mangago requests should use. Defaults to the desktop
// Chrome UA (DESKTOP_USER_AGENT) so behaviour is unchanged unless the reader
// picks another preset.
export function getSelectedUserAgent(): string {
  const id = getSelectedUserAgentId();
  return USER_AGENT_OPTIONS.find((option) => option.id === id)?.value ?? DESKTOP_USER_AGENT;
}

export function setSelectedUserAgentId(id: string): void {
  const valid = USER_AGENT_OPTIONS.some((option) => option.id === id);
  Application.setState(valid ? id : USER_AGENT_OPTIONS[0].id, USER_AGENT_STATE_KEY);
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
