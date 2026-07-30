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
  swapAccessTokens,
} from "../network";

export class SettingsForm extends Form {
  override getSections() {
    return [
      Section("account", [NavigationRow("account", { title: "Account", form: new AccountForm() })]),
    ];
  }
}

// Hosts the login row and nothing else: no lifecycle hook and no request runs
// here, so the form is inert while the login WebView opens and closes over it.
class AccountForm extends Form {
  override getSections() {
    if (!isAuthenticated()) {
      return [
        Section("login", [
          OAuthButtonRow("oAuthButton", {
            title: "Log in with MangaBaka",
            clientId: OAUTH_CLIENT_ID,
            authorizeEndpoint: OAUTH_AUTHORIZE_URL,
            redirectUri: OAUTH_REDIRECT_URI,
            scopes: OAUTH_SCOPES,
            responseType: {
              type: "pkce",
              tokenEndpoint: OAUTH_TOKEN_URL,
              pkceCodeLength: 64,
              pkceCodeMethod: "S256",
              formEncodeGrant: true,
            },
            onSuccess: Application.Selector(this as AccountForm, "handleOAuthSuccess"),
          }),
        ]),
        Section(
          {
            id: "token",
            header: "Access Token",
            footer:
              "Alternative to logging in: paste a personal access token from mangabaka.org. It starts with mb-.",
          },
          [
            InputRow("token", {
              title: "Access Token",
              value: "",
              isSecureEntry: true,
              onValueChange: Application.Selector(this as AccountForm, "handleTokenChange"),
            }),
          ],
        ),
      ];
    }

    return [
      Section("session", [
        NavigationRow("profile", { title: "Account Info", form: new ProfileForm() }),
        ButtonRow("logout", {
          title: "Log Out",
          onSelect: Application.Selector(this as AccountForm, "handleLogout"),
        }),
      ]),
    ];
  }

  async handleOAuthSuccess(first: string, second: string): Promise<void> {
    setAccessTokens(first, second);
    this.reloadForm();
  }

  async handleTokenChange(value: string): Promise<void> {
    const token = value.trim();
    if (!token) return;

    setToken(token);
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
      // The host does not guarantee which OAuth token arrives first, so a
      // rejected pair is retried the other way round before giving up.
      if (swapAccessTokens()) {
        try {
          await this.fetchProfile();
        } catch (retryError) {
          this.error = retryError instanceof Error ? retryError.message : String(retryError);
        }
      } else {
        this.error = error instanceof Error ? error.message : String(error);
      }
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
      ]),
    ];
  }
}
