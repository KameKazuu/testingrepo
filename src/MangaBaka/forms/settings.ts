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
  ToggleRow,
  WebViewRow,
  type Cookie,
} from "@paperback/types";

import {
  DOMAIN,
  type Envelope,
  LIBRARY_STATES,
  type Profile,
  TITLE_PREFERENCE_KEY,
} from "../models";
import {
  clearToken,
  getProfile,
  isAuthenticated,
  loginWithCookies,
  makeRequest,
  prepareOAuthAuthorizeUrl,
  refreshProfile,
  setProfile,
  setToken,
} from "../network";
import { getTitlePreference, TITLE_PREFERENCES } from "../parsers";

const AUTO_COMPLETE_KEY = "mangabaka-auto-complete";

// Completing a finished title is the helpful default; the toggle stores only
// an explicit user override.
export function autoCompleteEnabled(): boolean {
  const stored = Application.getState(AUTO_COMPLETE_KEY);
  return typeof stored === "boolean" ? stored : true;
}

function humanizeSlug(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export class SettingsForm extends Form {
  private token = "";
  private error?: string;
  private authorizeUrl?: string;
  private preparingLogin = false;
  private busy = false;

  override formWillAppear(): void {
    if (!isAuthenticated()) void this.prepareLogin();
  }

  private async prepareLogin(): Promise<void> {
    if (this.preparingLogin || this.authorizeUrl != undefined) return;

    this.preparingLogin = true;
    try {
      this.authorizeUrl = await prepareOAuthAuthorizeUrl();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Could not prepare MangaBaka login.";
    } finally {
      this.preparingLogin = false;
      this.reloadForm();
    }
  }

  override getSections() {
    const authenticated = isAuthenticated();
    const profile = getProfile();
    const sections = [
      this.error == undefined
        ? undefined
        : Section("error", [LabelRow("error", { title: "Error", subtitle: this.error })]),
      authenticated ? this.accountSection() : this.tokenSection(),
      authenticated ? undefined : this.loginSection(),
      authenticated && profile != undefined ? this.mangaBakaSection(profile) : undefined,
      this.titleSection(),
      authenticated ? this.syncSection() : undefined,
      this.aboutSection(),
    ];

    return sections.filter((section) => section != undefined);
  }

  private accountSection() {
    const profile = getProfile();
    const name = profile?.preferred_username ?? profile?.nickname;
    const details = [profile?.auth_type, profile?.role].filter((value): value is string =>
      Boolean(value),
    );

    return Section(
      {
        id: "account",
        header: "Account",
        footer: "Logging out removes the stored MangaBaka token from this device.",
      },
      [
        LabelRow("status", {
          title: name ? `Logged in as ${name}` : "Logged in to MangaBaka",
          subtitle: details.length > 0 ? details.join(" • ") : "Library syncing is enabled",
        }),
        NavigationRow("profile", { title: "Account Info", form: new ProfileForm() }),
        ButtonRow("logout", {
          title: "Log Out",
          onSelect: Application.Selector(this as SettingsForm, "handleLogout"),
        }),
      ],
    );
  }

  private mangaBakaSection(profile: Profile) {
    const rawDefaultState = profile.library_default_state ?? "plan_to_read";
    const defaultState =
      LIBRARY_STATES.find((state) => state.id === rawDefaultState)?.title ??
      humanizeSlug(rawDefaultState);

    return Section(
      {
        id: "mangabakaSettings",
        header: "MangaBaka settings",
        footer:
          "These are set on MangaBaka and used here. Opening the page signs you in again — Paperback cannot pass its login into the web view — but your settings are re-read as soon as you close it.",
      },
      [
        LabelRow("defaultState", {
          title: "Default library state",
          subtitle: "Used when you add a title from the tracker.",
          value: { text: defaultState },
        }),
        LabelRow("ratingSteps", {
          title: "Score increment",
          subtitle: "Scores are always stored out of 100.",
          value: { text: String(profile.rating_steps ?? 1) },
        }),
        LabelRow("role", {
          title: "Role",
          value: { text: humanizeSlug(profile.role ?? "user") },
        }),
        WebViewRow("websiteSettings", {
          title: "Open on MangaBaka (sign-in required)",
          request: { url: `${DOMAIN}/auth?redirect_to=/my/settings`, method: "GET" },
          onComplete: Application.Selector(this as SettingsForm, "handleSettingsClosed"),
          onCancel: Application.Selector(this as SettingsForm, "handleSettingsClosed"),
        }),
      ],
    );
  }

  private tokenSection() {
    return Section(
      {
        id: "token",
        header: "Access Token",
        footer:
          "Optional fallback: create a personal access token on mangabaka.org and paste it here. It starts with mb-.",
      },
      [
        InputRow("token", {
          title: "Access Token",
          value: this.token,
          isSecureEntry: true,
          onValueChange: Application.Selector(this as SettingsForm, "handleTokenChange"),
        }),
        ButtonRow("saveToken", {
          title: "Save Access Token",
          onSelect: Application.Selector(this as SettingsForm, "handleTokenSubmit"),
        }),
      ],
    );
  }

  private loginSection() {
    return Section(
      {
        id: "login",
        header: "MangaBaka Login",
        footer:
          "Sign in, grant access, then tap Done when MangaBaka says it is redirecting back to the app. Your password is never stored by the extension.",
      },
      [
        LabelRow("loginStatus", {
          title: this.busy ? "Finishing login..." : "Not logged in",
        }),
        this.authorizeUrl == undefined
          ? LabelRow("preparing", { title: "Preparing login..." })
          : WebViewRow("login", {
              title: "Log In",
              request: { url: this.authorizeUrl, method: "GET" },
              onComplete: Application.Selector(this as SettingsForm, "handleLoginComplete"),
              onCancel: Application.Selector(this as SettingsForm, "handleLoginCancel"),
            }),
      ],
    );
  }

  private titleSection() {
    return Section(
      {
        id: "titles",
        header: "Titles",
        footer:
          "MangaBaka stores a title per language. Choose which one to display. Titles you have already opened keep their old name until they are refreshed.",
      },
      [
        SelectRow("titlePreference", {
          title: "Title Language",
          value: [getTitlePreference()],
          layout: "list",
          items: TITLE_PREFERENCES,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as SettingsForm, "handleTitlePreferenceChange"),
        }),
      ],
    );
  }

  private syncSection() {
    return Section(
      {
        id: "sync",
        header: "Sync",
        footer:
          "When the last chapter of a finished series is read, mark it as Completed and record the finish date.",
      },
      [
        ToggleRow("autoComplete", {
          title: "Complete finished series",
          value: autoCompleteEnabled(),
          onValueChange: Application.Selector(this as SettingsForm, "handleAutoCompleteChange"),
        }),
      ],
    );
  }

  private aboutSection() {
    return Section(
      {
        id: "about",
        header: "About",
        footer:
          "Series data is provided by MangaBaka (mangabaka.org) under CC BY-NC-SA 4.0, aggregating AniList, MyAnimeList, MangaUpdates, Kitsu, Anime-Planet, Shikimori and Anime News Network.",
      },
      [LabelRow("attribution", { title: "Data by MangaBaka", subtitle: DOMAIN })],
    );
  }

  async handleLoginComplete(cookies: Cookie[]): Promise<void> {
    if (this.busy) return;

    this.busy = true;
    this.error = undefined;
    this.reloadForm();

    try {
      await loginWithCookies(cookies);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "MangaBaka login failed.";
    } finally {
      this.busy = false;
      this.authorizeUrl = undefined;
      if (!isAuthenticated()) void this.prepareLogin();
      this.reloadForm();
    }
  }

  async handleLoginCancel(): Promise<void> {
    this.error = "Login was closed before it finished. Please try again.";
    this.authorizeUrl = undefined;
    void this.prepareLogin();
    this.reloadForm();
  }

  async handleSettingsClosed(_cookies?: Cookie[]): Promise<void> {
    try {
      await refreshProfile();
      this.error = undefined;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Could not refresh account settings.";
    }
    this.reloadForm();
  }

  async handleTitlePreferenceChange(value: string[]): Promise<void> {
    const preference = value[0];
    if (preference == undefined) return;
    Application.setState(preference, TITLE_PREFERENCE_KEY);
  }

  async handleAutoCompleteChange(value: boolean): Promise<void> {
    Application.setState(value, AUTO_COMPLETE_KEY);
  }

  async handleTokenChange(value: string): Promise<void> {
    this.token = value;
  }

  async handleTokenSubmit(): Promise<void> {
    const token = this.token.trim();
    if (!token) return;

    try {
      const response = await makeRequest<Envelope<Profile>>("/v1/my/profile", {
        headers: { "x-api-key": token },
      });
      setToken(token);
      setProfile(response.data);
      this.token = "";
      this.error = undefined;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.reloadForm();
  }

  async handleLogout(): Promise<void> {
    clearToken();
    this.error = undefined;
    this.authorizeUrl = undefined;
    void this.prepareLogin();
    this.reloadForm();
  }
}

class ProfileForm extends Form {
  private profile?: Profile;
  private error?: string;

  override formWillAppear(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.profile = await refreshProfile();
      this.error = undefined;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.reloadForm();
  }

  override getSections() {
    if (this.error != undefined) {
      return [Section("error", [LabelRow("error", { title: "Error", subtitle: this.error })])];
    }

    const profile = this.profile ?? getProfile();
    return [
      Section("profile", [
        LabelRow("user", {
          title: "Signed in as",
          subtitle: profile?.preferred_username ?? profile?.nickname ?? "Loading...",
        }),
        LabelRow("method", {
          title: "Signed in with",
          subtitle: profile?.auth_type ?? "Loading...",
        }),
        LabelRow("defaultState", {
          title: "Default Library Status",
          subtitle: profile?.library_default_state ?? "Plan to Read",
        }),
        LabelRow("ratingSteps", {
          title: "Score Increment",
          subtitle: profile?.rating_steps ? String(profile.rating_steps) : "1",
        }),
      ]),
    ];
  }
}
