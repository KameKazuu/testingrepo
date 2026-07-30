/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  NavigationRow,
  Section,
  SelectRow,
  StepperRow,
  ToggleRow,
} from "@paperback/types";

import { type Envelope, LIBRARY_STATES, type LibraryEntry, RATING_SCALE } from "../models";
import { makeRequest } from "../network";

export class ProgressForm extends Form {
  private readonly seriesId: string;
  private entry?: LibraryEntry;
  private exists = false;
  private error?: string;

  constructor(seriesId: string) {
    super();
    this.seriesId = seriesId;
  }

  override requiresExplicitSubmission = true;

  override formWillAppear(): void {
    makeRequest<Envelope<LibraryEntry>>(`/v1/my/library/${this.seriesId}`, { needsAuth: true })
      .then((response) => {
        this.entry = response.data;
        this.exists = true;
      })
      .catch((error: Error) => {
        // A missing entry is the normal "not tracked yet" case; anything else
        // is a real failure worth showing.
        if (error.message.includes("[404]")) {
          this.entry = { state: "reading", progress_chapter: 0, progress_volume: 0, rating: 0 };
          this.exists = false;
        } else {
          this.error = error.message;
        }
      })
      .finally(() => {
        this.reloadForm();
      });
  }

  override getSections() {
    if (this.error != undefined) {
      return [Section("error", [LabelRow("error", { title: "Error", subtitle: this.error })])];
    }

    if (this.entry == undefined) {
      return [Section("loading", [LabelRow("loading", { title: "Loading..." })])];
    }

    const entry = this.entry;
    const sections = [
      Section({ id: "progress", header: "Progress" }, [
        SelectRow("state", {
          title: "Status",
          value: [entry.state ?? "reading"],
          minItemCount: 1,
          maxItemCount: 1,
          options: LIBRARY_STATES,
          onValueChange: Application.Selector(this as ProgressForm, "handleStateChange"),
        }),
        StepperRow("chapter", {
          title: "Chapters",
          subtitle: "The highest read chapter number",
          value: entry.progress_chapter ?? 0,
          minValue: 0,
          maxValue: 10000,
          stepValue: 1,
          loopOver: false,
          onValueChange: Application.Selector(this as ProgressForm, "handleChapterChange"),
        }),
        StepperRow("volume", {
          title: "Volumes",
          subtitle: "The highest read volume number",
          value: entry.progress_volume ?? 0,
          minValue: 0,
          maxValue: 10000,
          stepValue: 1,
          loopOver: false,
          onValueChange: Application.Selector(this as ProgressForm, "handleVolumeChange"),
        }),
        StepperRow("rereads", {
          title: "Reread Count",
          subtitle: "The amount of times you have reread the title",
          value: entry.number_of_rereads ?? 0,
          minValue: 0,
          maxValue: 1000,
          stepValue: 1,
          loopOver: false,
          onValueChange: Application.Selector(this as ProgressForm, "handleRereadsChange"),
        }),
      ]),
      Section({ id: "score", header: "Score" }, [
        StepperRow("rating", {
          title: "Score",
          subtitle: "Set to 0 to leave the title unrated",
          value: (entry.rating ?? 0) / RATING_SCALE,
          minValue: 0,
          maxValue: 10,
          stepValue: 0.1,
          loopOver: false,
          onValueChange: Application.Selector(this as ProgressForm, "handleRatingChange"),
        }),
      ]),
      Section({ id: "privacy", header: "Privacy" }, [
        ToggleRow("private", {
          title: "Private",
          value: entry.is_private ?? false,
          onValueChange: Application.Selector(this as ProgressForm, "handlePrivateChange"),
        }),
      ]),
      Section({ id: "note", header: "Note", footer: "Only you can see your note" }, [
        InputRow("note", {
          title: "Note",
          value: entry.note ?? "",
          onValueChange: Application.Selector(this as ProgressForm, "handleNoteChange"),
        }),
      ]),
    ];

    if (this.exists) {
      sections.push(
        Section({ id: "delete", footer: "Remove the title from your MangaBaka library" }, [
          NavigationRow("delete", {
            title: "Delete",
            form: new DeletionForm(this.seriesId),
          }),
        ]),
      );
    }

    return sections;
  }

  async handleStateChange(value: string[]): Promise<void> {
    this.entry!.state = value[0] ?? "reading";
  }

  async handleChapterChange(value: number): Promise<void> {
    this.entry!.progress_chapter = value;
    this.reloadForm();
  }

  async handleVolumeChange(value: number): Promise<void> {
    this.entry!.progress_volume = value;
    this.reloadForm();
  }

  async handleRereadsChange(value: number): Promise<void> {
    this.entry!.number_of_rereads = value;
    this.reloadForm();
  }

  async handleRatingChange(value: number): Promise<void> {
    this.entry!.rating = Math.round(value * RATING_SCALE);
    this.reloadForm();
  }

  async handlePrivateChange(value: boolean): Promise<void> {
    this.entry!.is_private = value;
  }

  async handleNoteChange(value: string): Promise<void> {
    this.entry!.note = value;
  }

  override async formDidSubmit(): Promise<void> {
    const entry = this.entry;
    if (entry == undefined) return;

    await makeRequest(`/v1/my/library/${this.seriesId}`, {
      method: this.exists ? "PATCH" : "POST",
      needsAuth: true,
      body: {
        state: entry.state ?? "reading",
        progress_chapter: entry.progress_chapter ?? 0,
        progress_volume: entry.progress_volume ?? 0,
        number_of_rereads: entry.number_of_rereads ?? 0,
        rating: entry.rating ? entry.rating : null,
        is_private: entry.is_private ?? false,
        note: entry.note ? entry.note : null,
      },
    });
  }

  override formDidCancel(): void {
    return;
  }
}

class DeletionForm extends Form {
  private readonly seriesId: string;
  private deleted = false;

  constructor(seriesId: string) {
    super();
    this.seriesId = seriesId;
  }

  override getSections() {
    if (this.deleted) {
      return [Section("deleted", [LabelRow("deleted", { title: "Deleted" })])];
    }

    return [
      Section(
        {
          id: "delete",
          footer: "WARNING: The library entry will be removed, this action can not be undone",
        },
        [
          ButtonRow("delete", {
            title: "Delete",
            onSelect: Application.Selector(this as DeletionForm, "handleDelete"),
          }),
        ],
      ),
    ];
  }

  async handleDelete(): Promise<void> {
    await makeRequest(`/v1/my/library/${this.seriesId}`, {
      method: "DELETE",
      needsAuth: true,
    });
    this.deleted = true;
    this.reloadForm();
  }
}
