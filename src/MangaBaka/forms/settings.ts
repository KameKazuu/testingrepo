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
  WebViewRow,
  type Cookie,
} from "@paperback/types";

import { DOMAIN, type Envelope, type Profile, TITLE_PREFERENCE_KEY } from "../models";
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
    const sections = [
      this.error == undefined
        ? undefined
        : Section("error", [LabelRow("error", { title: "Error", subtitle: this.error })]),
      isAuthenticated() ? this.accountSection() : this.tokenSection(),
      isAuthenticated() ? undefined : this.loginSection(),
      this.titleSection(),
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
        footer:
          "Opening MangaBaka settings may ask you to sign in again. Account changes are refreshed when the window closes.",
      },
      [
        LabelRow("status", {
          title: name ? `Logged in as ${name}` : "Logged in to MangaBaka",
          subtitle: details.length > 0 ? details.join(" • ") : "Library syncing is enabled",
        }),
        NavigationRow("profile", { title: "Account Info", form: new ProfileForm() }),
        WebViewRow("websiteSettings", {
          title: "Open MangaBaka Settings",
          request: { url: `${DOMAIN}/auth?redirect_to=/my/settings`, method: "GET" },
          onComplete: Application.Selector(this as SettingsForm, "handleSettingsClosed"),
          onCancel: Application.Selector(this as SettingsForm, "handleSettingsClosed"),
        }),
        ButtonRow("logout", {
          title: "Log Out",
          onSelect: Application.Selector(this as SettingsForm, "handleLogout"),
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
        footer: "Choose which MangaBaka title language is preferred throughout the extension.",
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
