/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ButtonRow,
  type Cookie,
  Form,
  InputRow,
  LabelRow,
  NavigationRow,
  Section,
  WebViewRow,
} from "@paperback/types";

import { type Envelope, LOGIN_URL, type Profile } from "../models";
import {
  clearToken,
  cookieStorage,
  isAuthenticated,
  makeRequest,
  setRatingSteps,
  setSessionAuthenticated,
  setToken,
} from "../network";

// The web view row is hosted by the root form, which is the only place one is
// known to work; pushed forms appear to render it inert.
export class SettingsForm extends Form {
  private token = "";
  private error?: string;

  override getSections() {
    if (isAuthenticated()) {
      return [
        Section("session", [
          NavigationRow("profile", { title: "Account Info", form: new ProfileForm() }),
          ButtonRow("logout", {
            title: "Log Out",
            onSelect: Application.Selector(this as SettingsForm, "handleLogout"),
          }),
        ]),
      ];
    }

    return [
      this.error == undefined
        ? undefined
        : Section("error", [LabelRow("error", { title: "Error", subtitle: this.error })]),
      Section(
        {
          id: "token",
          header: "Access Token",
          footer:
            "Create a personal access token on mangabaka.org and paste it here. It starts with mb-.",
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
      ),
      Section(
        {
          id: "browser",
          header: "Browser Login",
          footer: "Sign in on mangabaka.org and the session is reused for your library.",
        },
        [
          WebViewRow("webViewLogin", {
            title: "Log In",
            request: { url: LOGIN_URL, method: "GET" },
            isHidden: false,
            onComplete: Application.Selector(this as SettingsForm, "handleWebViewLogin"),
            onCancel: Application.Selector(this as SettingsForm, "handleWebViewCancel"),
          }),
        ],
      ),
    ].filter((section) => section != undefined);
  }

  async handleWebViewLogin(cookies: Cookie[]): Promise<void> {
    for (const cookie of cookies) {
      if (cookie.domain.replace(/^\./, "").endsWith("mangabaka.org")) {
        cookieStorage.setCookie(cookie);
      }
    }

    try {
      const response = await makeRequest<Envelope<Profile>>("/v1/my/profile");
      setSessionAuthenticated();
      setRatingSteps(response.data.rating_steps);
      this.error = undefined;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.reloadForm();
  }

  async handleWebViewCancel(): Promise<void> {
    this.reloadForm();
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
      setRatingSteps(response.data.rating_steps);
      this.token = "";
      this.error = undefined;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.reloadForm();
  }

  async handleLogout(): Promise<void> {
    clearToken();
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
      await this.fetchProfile();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.reloadForm();
  }

  private async fetchProfile(): Promise<void> {
    const response = await makeRequest<Envelope<Profile>>("/v1/my/profile", { needsAuth: true });
    this.profile = response.data;
    setRatingSteps(response.data.rating_steps);
    this.error = undefined;
  }

  override getSections() {
    if (this.error != undefined) {
      return [Section("error", [LabelRow("error", { title: "Error", subtitle: this.error })])];
    }

    return [
      Section("profile", [
        LabelRow("user", {
          title: "Signed in as",
          subtitle: this.profile?.preferred_username ?? this.profile?.nickname ?? "Loading...",
        }),
        LabelRow("method", {
          title: "Signed in with",
          subtitle: this.profile?.auth_type ?? "Loading...",
        }),
      ]),
    ];
  }
}
