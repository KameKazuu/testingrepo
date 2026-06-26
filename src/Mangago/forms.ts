import {
  AdvancedSearchForm,
  ButtonRow,
  Form,
  SelectRow,
  Section,
  ToggleRow,
  TriStateSelectRow,
  type SearchQuery,
} from "@paperback/types";

import {
  DISCOVER_SECTION_OPTIONS,
  GENRE_OPTIONS,
  genreIdFromTitle,
  getDiscoverSectionEnabled,
  resetDiscoverSectionSettings,
  setDiscoverSectionEnabled,
  type MangagoSearchMetadata,
  STATUS_OPTIONS,
} from "./models";

function normalizeGenreSelections(
  genres: Record<string, "included" | "excluded"> | undefined,
): Record<string, "included" | "excluded"> {
  const normalized: Record<string, "included" | "excluded"> = {};
  const validIds = new Set(GENRE_OPTIONS.map((genre) => genre.id));

  for (const [idOrTitle, state] of Object.entries(genres ?? {})) {
    const id = validIds.has(idOrTitle) ? idOrTitle : genreIdFromTitle(idOrTitle);
    if (validIds.has(id)) normalized[id] = state;
  }

  return normalized;
}

export class MangagoAdvancedSearchForm extends AdvancedSearchForm {
  private genres: Record<string, "included" | "excluded">;
  private statuses: string[];

  constructor(searchQuery?: SearchQuery<MangagoSearchMetadata>) {
    super();

    this.genres = normalizeGenreSelections(searchQuery?.metadata?.genres);
    if (searchQuery?.metadata?.genre) {
      const genreId = genreIdFromTitle(searchQuery.metadata.genre);
      if (GENRE_OPTIONS.some((genre) => genre.id === genreId)) this.genres[genreId] = "included";
    }
    this.statuses = searchQuery?.metadata?.statuses ?? STATUS_OPTIONS.map((status) => status.id);
  }

  override getSections() {
    return [
      Section("genre", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: GENRE_OPTIONS,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as MangagoAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),
      Section("status", [
        SelectRow("statuses", {
          title: "Status",
          layout: "flow",
          value: this.statuses,
          items: STATUS_OPTIONS.map((status) => ({ id: status.id, title: status.label })),
          minItemCount: 1,
          maxItemCount: STATUS_OPTIONS.length,
          onValueChange: Application.Selector(
            this as MangagoAdvancedSearchForm,
            "handleStatusesChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = normalizeGenreSelections(value);
  }

  async handleStatusesChange(value: string[]): Promise<void> {
    this.statuses = value.filter((status) => STATUS_OPTIONS.some((option) => option.id === status));
  }

  override getSearchQueryMetadata(): MangagoSearchMetadata {
    const metadata: MangagoSearchMetadata = {};
    if (Object.keys(this.genres).length > 0) metadata.genres = this.genres;
    if (this.statuses.length !== STATUS_OPTIONS.length) metadata.statuses = this.statuses;
    return metadata;
  }
}

export class MangagoSettingsForm extends Form {
  override getSections() {
    return [
      Section(
        {
          id: "discover_sections",
          header: "Home Sections",
        },
        DISCOVER_SECTION_OPTIONS.map((section) =>
          ToggleRow(section.id, {
            title: section.title,
            value: getDiscoverSectionEnabled(section.id),
            onValueChange: Application.Selector(
              this as MangagoSettingsForm,
              `handle_${section.id}` as never,
            ),
          }),
        ),
      ),
      Section("reset", [
        ButtonRow("resetDiscoverSections", {
          title: "Reset Home Sections",
          onSelect: Application.Selector(
            this as MangagoSettingsForm,
            "handleResetDiscoverSections",
          ),
        }),
      ]),
    ];
  }

  constructor() {
    super();
    for (const section of DISCOVER_SECTION_OPTIONS) {
      (this as Record<string, unknown>)[`handle_${section.id}`] = async (
        enabled: boolean,
      ): Promise<void> => {
        setDiscoverSectionEnabled(section.id, enabled);
        Application.invalidateDiscoverSections();
      };
    }
  }

  async handleResetDiscoverSections(): Promise<void> {
    resetDiscoverSectionSettings();
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }
}
