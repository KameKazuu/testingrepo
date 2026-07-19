/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  Form,
  InputRow,
  Section,
  SelectRow,
  ToggleRow,
  type FormItemElement,
  type FormSectionElement,
  type InputRowProps,
  type SelectRowProps,
  type ToggleRowProps,
} from "@paperback/types";

import {
  CHAPTER_TITLE_MODE_OPTIONS,
  CONTENT_RATING_OPTIONS,
  FORMAT_OPTIONS,
  HIDDEN_TAG_CATEGORIES,
  LANGUAGE_OPTIONS,
  SOURCE_DISPLAY_MODE_OPTIONS,
} from "../shared/models";
import {
  getChapterTitleMode,
  getContentLanguages,
  getContentRatingSetting,
  getCustomHiddenTags,
  getDataSaver,
  getExcludedGenres,
  getHiddenFormats,
  getHiddenTagCategories,
  getShowEdition,
  getShowSource,
  getShowSpoilerTags,
  getSourceDisplayMode,
  setChapterTitleMode,
  setContentLanguages,
  setContentRatingSetting,
  setCustomHiddenTags,
  setDataSaver,
  setExcludedGenres,
  setHiddenFormats,
  setHiddenTagCategories,
  setShowEdition,
  setShowSource,
  setShowSpoilerTags,
  setSourceDisplayMode,
} from "./main";

export class KaganeSettingsForm extends Form {
  private genreOptions: { id: string; title: string }[];

  constructor(genreOptions: { id: string; title: string }[] = []) {
    super();
    this.genreOptions = genreOptions;
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section(
        {
          id: "content",
          footer:
            "safe: Family-friendly content suitable for all ages. No mature themes.\n\nsuggestive: Includes mild fan service, romantic themes, and suggestive content.\n\nerotica: Includes sexual content, violence, and mature themes. Not explicit pornography.\n\npornographic: All content including explicit sexual material.",
        },
        [
          this.contentLanguagesRow(),
          this.contentRatingRow(),
          this.sourceDisplayModeRow(),
          this.excludedGenresRow(),
        ],
      ),
      Section(
        {
          id: "content-filters",
          footer:
            "Hidden formats and tags are removed from the home page, listings, and search results. Custom Hidden Tags is a comma-separated list of exact tag names, like: Love Triangle, Amnesia",
        },
        [this.hiddenFormatsRow(), this.hiddenTagCategoriesRow(), this.customHiddenTagsRow()],
      ),
      Section("display", [
        this.showEditionRow(),
        this.showSourceRow(),
        this.showSpoilerTagsRow(),
        this.chapterTitleModeRow(),
      ]),
      Section("reader", [this.dataSaverRow()]),
    ];
  }

  contentLanguagesRow(): FormItemElement<unknown> {
    const props: SelectRowProps = {
      title: "Content Languages",
      options: LANGUAGE_OPTIONS,
      value: getContentLanguages(),
      minItemCount: 1,
      maxItemCount: LANGUAGE_OPTIONS.length,
      onValueChange: Application.Selector(this as KaganeSettingsForm, "handleContentLanguages"),
    };

    return SelectRow("content-languages", props);
  }

  contentRatingRow(): FormItemElement<unknown> {
    const props: SelectRowProps = {
      title: "Content Rating",
      options: CONTENT_RATING_OPTIONS,
      value: [getContentRatingSetting()],
      minItemCount: 1,
      maxItemCount: 1,
      onValueChange: Application.Selector(this as KaganeSettingsForm, "handleContentRating"),
    };

    return SelectRow("content-rating", props);
  }

  sourceDisplayModeRow(): FormItemElement<unknown> {
    const props: SelectRowProps = {
      title: "Sources",
      options: SOURCE_DISPLAY_MODE_OPTIONS,
      value: [getSourceDisplayMode()],
      minItemCount: 1,
      maxItemCount: 1,
      onValueChange: Application.Selector(this as KaganeSettingsForm, "handleSourceDisplayMode"),
    };

    return SelectRow("source-display-mode", props);
  }

  excludedGenresRow(): FormItemElement<unknown> {
    const props: SelectRowProps = {
      title: "Excluded Genres",
      options: this.genreOptions,
      value: getExcludedGenres(),
      minItemCount: 0,
      maxItemCount: Math.max(this.genreOptions.length, 1),
      onValueChange: Application.Selector(this as KaganeSettingsForm, "handleExcludedGenres"),
    };

    return SelectRow("excluded-genres", props);
  }

  showEditionRow(): FormItemElement<unknown> {
    const props: ToggleRowProps = {
      title: "Show Edition in Title",
      value: getShowEdition(),
      onValueChange: Application.Selector(this as KaganeSettingsForm, "handleShowEdition"),
    };

    return ToggleRow("show-edition", props);
  }

  showSourceRow(): FormItemElement<unknown> {
    const props: ToggleRowProps = {
      title: "Show Source in Title",
      value: getShowSource(),
      onValueChange: Application.Selector(this as KaganeSettingsForm, "handleShowSource"),
    };

    return ToggleRow("show-source", props);
  }

  chapterTitleModeRow(): FormItemElement<unknown> {
    const props: SelectRowProps = {
      title: "Chapter Title Format",
      options: CHAPTER_TITLE_MODE_OPTIONS,
      value: [getChapterTitleMode()],
      minItemCount: 1,
      maxItemCount: 1,
      onValueChange: Application.Selector(this as KaganeSettingsForm, "handleChapterTitleMode"),
    };

    return SelectRow("chapter-title-mode", props);
  }

  hiddenFormatsRow(): FormItemElement<unknown> {
    const props: SelectRowProps = {
      title: "Hidden Formats",
      options: FORMAT_OPTIONS.map((format) => ({ id: format, title: format })),
      value: getHiddenFormats(),
      minItemCount: 0,
      maxItemCount: FORMAT_OPTIONS.length - 1,
      onValueChange: Application.Selector(this as KaganeSettingsForm, "handleHiddenFormats"),
    };

    return SelectRow("hidden-formats", props);
  }

  hiddenTagCategoriesRow(): FormItemElement<unknown> {
    const props: SelectRowProps = {
      title: "Hidden Tags",
      options: HIDDEN_TAG_CATEGORIES.map((category) => ({
        id: category.id,
        title: category.title,
      })),
      value: getHiddenTagCategories(),
      minItemCount: 0,
      maxItemCount: HIDDEN_TAG_CATEGORIES.length,
      onValueChange: Application.Selector(this as KaganeSettingsForm, "handleHiddenTagCategories"),
    };

    return SelectRow("hidden-tag-categories", props);
  }

  customHiddenTagsRow(): FormItemElement<unknown> {
    const props: InputRowProps = {
      title: "Custom Hidden Tags",
      value: getCustomHiddenTags().join(", "),
      onValueChange: Application.Selector(this as KaganeSettingsForm, "handleCustomHiddenTags"),
    };

    return InputRow("custom-hidden-tags", props);
  }

  showSpoilerTagsRow(): FormItemElement<unknown> {
    const props: ToggleRowProps = {
      title: "Show Spoiler Tags",
      value: getShowSpoilerTags(),
      onValueChange: Application.Selector(this as KaganeSettingsForm, "handleShowSpoilerTags"),
    };

    return ToggleRow("show-spoiler-tags", props);
  }

  dataSaverRow(): FormItemElement<unknown> {
    const props: ToggleRowProps = {
      title: "Data Saver",
      value: getDataSaver(),
      onValueChange: Application.Selector(this as KaganeSettingsForm, "handleDataSaver"),
    };

    return ToggleRow("data-saver", props);
  }

  async handleContentLanguages(value: string[]): Promise<void> {
    setContentLanguages(value);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleContentRating(value: string[]): Promise<void> {
    setContentRatingSetting(value[0] ?? "safe");
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleSourceDisplayMode(value: string[]): Promise<void> {
    setSourceDisplayMode(value[0] ?? "all");
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleExcludedGenres(value: string[]): Promise<void> {
    setExcludedGenres(value);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleShowEdition(value: boolean): Promise<void> {
    setShowEdition(value);
    this.reloadForm();
  }

  async handleShowSource(value: boolean): Promise<void> {
    setShowSource(value);
    this.reloadForm();
  }

  async handleChapterTitleMode(value: string[]): Promise<void> {
    setChapterTitleMode(value[0] ?? "optional");
    this.reloadForm();
  }

  async handleHiddenFormats(value: string[]): Promise<void> {
    setHiddenFormats(value);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleHiddenTagCategories(value: string[]): Promise<void> {
    setHiddenTagCategories(value);
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleCustomHiddenTags(value: string): Promise<void> {
    setCustomHiddenTags(value.split(","));
    Application.invalidateDiscoverSections();
    this.reloadForm();
  }

  async handleShowSpoilerTags(value: boolean): Promise<void> {
    setShowSpoilerTags(value);
    this.reloadForm();
  }

  async handleDataSaver(value: boolean): Promise<void> {
    setDataSaver(value);
    this.reloadForm();
  }
}
