/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ButtonRow,
  Form,
  InputRow,
  LabelRow,
  NavigationRow,
  OAuthButtonRow,
  Section,
} from "@paperback/types";

import {
  type Envelope,
  OAUTH_AUTHORIZE_URL,
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_URI,
  OAUTH_SCOPES,
  OAUTH_TOKEN_URL,
  type Profile,
} from "../models";
import {
  clearToken,
  isAuthenticated,
  makeRequest,
  setAccessTokens,
  setRatingSteps,
  setToken,
} from "../network";

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
          id: "oauth",
          header: "MangaBaka Login",
          footer: "Sign in on mangabaka.org and allow Paperback to update your library.",
        },
        [
          OAuthButtonRow("oauthLogin", {
            title: "Log In",
            authorizeEndpoint: OAUTH_AUTHORIZE_URL,
            clientId: OAUTH_CLIENT_ID,
            redirectUri: OAUTH_REDIRECT_URI,
            scopes: OAUTH_SCOPES,
            responseType: {
              type: "pkce",
              tokenEndpoint: OAUTH_TOKEN_URL,
              pkceCodeLength: 64,
              pkceCodeMethod: "S256",
              formEncodeGrant: true,
            },
            onSuccess: Application.Selector(this as SettingsForm, "handleOAuthSuccess"),
          }),
        ],
      ),
    ].filter((section) => section != undefined);
  }

  async handleOAuthSuccess(accessToken: string, refreshToken: string): Promise<void> {
    setAccessTokens(accessToken, refreshToken);
    this.error = undefined;
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
