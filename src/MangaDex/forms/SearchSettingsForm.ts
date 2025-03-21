import { Form, Section, SelectRow, ToggleRow } from "@paperback/types";
import {
    getRelevanceScoringEnabled,
    getSearchSortOrder,
    getShowChapter,
    getShowRatingIcons,
    getShowStatusIcons,
    getShowVolume,
    setRelevanceScoringEnabled,
    setSearchSortOrder,
    setShowChapter,
    setShowRatingIcons,
    setShowStatusIcons,
    setShowVolume,
} from "../MangaDexSettings";
import { State } from "../utils/StateUtil";

/**
 * Form for configuring search result settings
 * Controls display options and sort order for search results
 */
export class SearchSettingsForm extends Form {
    // Settings state objects
    private volumeState = new State<boolean>(
        this,
        "show_volume_in_subtitle",
        getShowVolume(),
    );
    private chapterState = new State<boolean>(
        this,
        "show_chapter_in_subtitle",
        getShowChapter(),
    );
    private statusIconsState = new State<boolean>(
        this,
        "show_status_icons",
        getShowStatusIcons(),
    );
    private ratingIconsState = new State<boolean>(
        this,
        "show_content_rating_icons",
        getShowRatingIcons(),
    );
    private sortOrderState = new State<string[]>(this, "search_sort_order", [
        getSearchSortOrder(),
    ]);
    private relevanceScoringState = new State<boolean>(
        this,
        "relevance_scoring_enabled",
        getRelevanceScoringEnabled(),
    );

    override getSections(): Application.FormSectionElement[] {
        const sortOptions = [
            { id: "", title: "Default (Latest Upload)" },
            { id: "order[relevance]-desc", title: "Best Match" },
            { id: "order[latestUploadedChapter]-desc", title: "Latest Upload" },
            { id: "order[latestUploadedChapter]-asc", title: "Oldest Upload" },
            { id: "order[title]-asc", title: "Title Ascending" },
            { id: "order[title]-desc", title: "Title Descending" },
            { id: "order[rating]-desc", title: "Highest Rating" },
            { id: "order[rating]-asc", title: "Lowest Rating" },
            { id: "order[followedCount]-desc", title: "Most Follows" },
            { id: "order[followedCount]-asc", title: "Least Follows" },
            { id: "order[createdAt]-desc", title: "Recently Added" },
            { id: "order[createdAt]-asc", title: "Oldest Added" },
            { id: "order[year]-asc", title: "Year Ascending" },
            { id: "order[year]-desc", title: "Year Descending" },
        ];

        const currentValue = this.sortOrderState.value[0];
        const currentOption = sortOptions.find(
            (option) => option.id === currentValue,
        );
        const currentSortTitle = currentOption?.title || "Default (None)";

        return [
            Section("sorting", [
                SelectRow("search_sort_order", {
                    title: "Search Sort Order",
                    subtitle: `Current: ${currentSortTitle}`,
                    value: this.sortOrderState.value,
                    options: sortOptions,
                    minItemCount: 1,
                    maxItemCount: 1,
                    onValueChange: Application.Selector(
                        this as SearchSettingsForm,
                        "handleSortOrderChange",
                    ),
                }),
                ToggleRow("relevance_scoring_enabled", {
                    title: "Enable Relevance Scoring",
                    subtitle:
                        "Improved sort order for search results based on title relevance",
                    value: this.relevanceScoringState.value,
                    onValueChange: Application.Selector(
                        this as SearchSettingsForm,
                        "handleRelevanceScoringChange",
                    ),
                }),
            ]),
            Section("subtitle_content", [
                ToggleRow("show_volume_in_subtitle", {
                    title: "Show Volume in Subtitle",
                    subtitle:
                        "Note: Not all manga have volumes in the search API",
                    value: this.volumeState.value,
                    onValueChange: Application.Selector(
                        this as SearchSettingsForm,
                        "handleVolumeChange",
                    ),
                }),
                ToggleRow("show_chapter_in_subtitle", {
                    title: "Show Chapter in Subtitle",
                    subtitle:
                        "Note: Not all manga have chapters in the search API",
                    value: this.chapterState.value,
                    onValueChange: Application.Selector(
                        this as SearchSettingsForm,
                        "handleChapterChange",
                    ),
                }),
            ]),
            Section("subtitle_icons", [
                ToggleRow("show_status_icons", {
                    title: "Show Status Icons in Subtitle",
                    subtitle:
                        "✅ Completed, ▶️ Ongoing, ⏸️ Hiatus, ❌ Cancelled",
                    value: this.statusIconsState.value,
                    onValueChange: Application.Selector(
                        this as SearchSettingsForm,
                        "handleStatusIconsChange",
                    ),
                }),
                ToggleRow("show_content_rating_icons", {
                    title: "Show Content Rating Icons in Subtitle",
                    subtitle: "🟢 Safe, 🟡 Suggestive, 🟠 Erotica, 🔞 Adult",
                    value: this.ratingIconsState.value,
                    onValueChange: Application.Selector(
                        this as SearchSettingsForm,
                        "handleRatingIconsChange",
                    ),
                }),
            ]),
        ];
    }

    // Settings change handlers
    async handleSortOrderChange(value: string[]): Promise<void> {
        await this.sortOrderState.updateValue(value);
        setSearchSortOrder(value[0]);
        this.reloadForm();
    }

    async handleVolumeChange(value: boolean): Promise<void> {
        await this.volumeState.updateValue(value);
        setShowVolume(value);
        this.reloadForm();
    }

    async handleChapterChange(value: boolean): Promise<void> {
        await this.chapterState.updateValue(value);
        setShowChapter(value);
        this.reloadForm();
    }

    async handleStatusIconsChange(value: boolean): Promise<void> {
        await this.statusIconsState.updateValue(value);
        setShowStatusIcons(value);
        this.reloadForm();
    }

    async handleRatingIconsChange(value: boolean): Promise<void> {
        await this.ratingIconsState.updateValue(value);
        setShowRatingIcons(value);
        this.reloadForm();
    }

    async handleRelevanceScoringChange(value: boolean): Promise<void> {
        await this.relevanceScoringState.updateValue(value);
        setRelevanceScoringEnabled(value);
        this.reloadForm();
    }
}
