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

import {
  DEFAULT_LIBRARY_PRIORITY,
  type Envelope,
  LIBRARY_PRIORITIES,
  LIBRARY_STATES,
  type LibraryEntry,
  RATING_SCALE,
} from "../models";
import {
  getDefaultLibraryState,
  getRatingSteps,
  getProfile,
  hasRatingSteps,
  MangaBakaError,
  makeRequest,
  refreshProfile,
} from "../network";

const today = (): string => {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}-${day}`;
};

export class ProgressForm extends Form {
  private readonly seriesId: string;
  private entry?: LibraryEntry;
  private exists = false;
  private error?: string;
  private loaded = false;

  constructor(seriesId: string) {
    super();
    this.seriesId = seriesId;
  }

  override requiresExplicitSubmission = true;

  override formWillAppear(): void {
    // The hook runs again on the way back from the deletion screen, and
    // refetching there would quietly throw away whatever has been typed in.
    if (this.loaded) return;
    this.loaded = true;
    void this.load();
  }

  private async load(): Promise<void> {
    let missing = false;
    try {
      const response = await makeRequest<Envelope<LibraryEntry>>(
        `/v1/my/library/${this.seriesId}`,
        { needsAuth: true },
      );
      this.entry = response.data;
      this.exists = true;
    } catch (error) {
      // A missing entry is the normal "not tracked yet" case; anything else
      // is a real failure worth showing.
      if (error instanceof MangaBakaError && error.status === 404) {
        missing = true;
        this.exists = false;
      } else {
        this.error = error instanceof Error ? error.message : String(error);
      }
    }

    // The score picker's increment comes from the account, and nothing else
    // on the way in fetches it, so a reader who never opens Account Info
    // would otherwise be offered scores their account cannot store.
    if (this.error == undefined && (!hasRatingSteps() || getProfile() == undefined)) {
      try {
        await refreshProfile();
      } catch {
        // Not worth failing the whole form over; the default still works.
      }
    }

    if (missing) {
      this.entry = {
        state: getDefaultLibraryState(),
        progress_chapter: 0,
        progress_volume: 0,
        rating: 0,
        priority: DEFAULT_LIBRARY_PRIORITY,
      };
    }

    this.reloadForm();
  }

  // Called by the deletion screen so this form knows the entry is gone and
  // submits a fresh one rather than patching something that no longer exists.
  handleDeleted(): void {
    this.entry = {
      state: getDefaultLibraryState(),
      progress_chapter: 0,
      progress_volume: 0,
      rating: 0,
      priority: DEFAULT_LIBRARY_PRIORITY,
    };
    this.exists = false;
    this.reloadForm();
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
          layout: "list",
          minItemCount: 1,
          maxItemCount: 1,
          items: LIBRARY_STATES,
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
          maxValue: RATING_SCALE,
          // `rating_steps` is the increment the account stores on the 0-100
          // scale, so a tenth of it is the increment on this 0-10 one.
          // Offering anything finer would store scores it cannot represent.
          stepValue: getRatingSteps() / RATING_SCALE,
          loopOver: false,
          onValueChange: Application.Selector(this as ProgressForm, "handleRatingChange"),
        }),
      ]),
      Section({ id: "organise", header: "Organise" }, [
        SelectRow("priority", {
          title: "Priority",
          value: [String(entry.priority ?? DEFAULT_LIBRARY_PRIORITY)],
          layout: "list",
          minItemCount: 1,
          maxItemCount: 1,
          items: LIBRARY_PRIORITIES,
          onValueChange: Application.Selector(this as ProgressForm, "handlePriorityChange"),
        }),
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
            form: new DeletionForm(this.seriesId, this),
          }),
        ]),
      );
    }

    return sections;
  }

  async handleStateChange(value: string[]): Promise<void> {
    this.entry!.state = value[0] ?? "reading";
    this.reloadForm();
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

  async handlePriorityChange(value: string[]): Promise<void> {
    const priority = Number(value[0]);
    if (!Number.isFinite(priority)) return;
    this.entry!.priority = priority;
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

    let startDate = entry.start_date ?? null;
    if (startDate == null && (entry.state === "reading" || entry.state === "completed")) {
      startDate = today();
    }

    let finishDate = entry.finish_date ?? null;
    if (finishDate == null && entry.state === "completed") finishDate = today();

    await makeRequest(`/v1/my/library/${this.seriesId}`, {
      method: this.exists ? "PATCH" : "POST",
      needsAuth: true,
      body: {
        state: entry.state ?? "reading",
        progress_chapter: entry.progress_chapter ?? 0,
        progress_volume: entry.progress_volume ?? 0,
        number_of_rereads: entry.number_of_rereads ?? 0,
        start_date: startDate,
        finish_date: finishDate,
        rating: entry.rating ? entry.rating : null,
        is_private: entry.is_private ?? false,
        priority: entry.priority ?? DEFAULT_LIBRARY_PRIORITY,
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
  private readonly parent: ProgressForm;
  private deleted = false;

  constructor(seriesId: string, parent: ProgressForm) {
    super();
    this.seriesId = seriesId;
    this.parent = parent;
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
    this.parent.handleDeleted();
    this.reloadForm();
  }
}
