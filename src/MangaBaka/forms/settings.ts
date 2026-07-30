/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ButtonRow, Form, InputRow, LabelRow, OAuthButtonRow, Section } from "@paperback/types";

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

// @paperback/types annotates onSuccess as (refreshToken, accessToken) but the
// iOS host delivers them the other way round. Both tokens are opaque strings,
// so the order cannot be told apart by shape — the profile request below
// decides, and the pair is swapped if the first choice is rejected.

export class SettingsForm extends Form {
  private profile?: Profile;
  private error?: string;

  override formWillAppear(): void {
    if (!isAuthenticated()) return;
    void this.loadProfile();
  }

  private async loadProfile(): Promise<void> {
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
    if (!isAuthenticated()) {
      return [
        Section({ id: "login", header: "Account" }, [
          OAuthButtonRow("oauth", {
            title: "Log in with MangaBaka",
            subtitle: "Sync your library and reading progress.",
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
            onSuccess: Application.Selector(this as SettingsForm, "handleOAuthSuccess"),
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
              onValueChange: Application.Selector(this as SettingsForm, "handleTokenChange"),
            }),
          ],
        ),
      ];
    }

    return [
      Section({ id: "account", header: "Account" }, [
        LabelRow("user", {
          title: "Signed in as",
          subtitle:
            this.error ??
            this.profile?.preferred_username ??
            this.profile?.nickname ??
            "Loading...",
        }),
        ButtonRow("logout", {
          title: "Log Out",
          onSelect: Application.Selector(this as SettingsForm, "handleLogout"),
        }),
      ]),
    ];
  }

  // Nothing may be awaited here: the callback runs while the login WebView is
  // being dismissed, so it only stores the tokens. The profile is fetched from
  // `loadProfile`, which also recovers if the pair arrived the other way round.
  async handleOAuthSuccess(first: string, second: string): Promise<void> {
    this.profile = undefined;
    this.error = undefined;
    setAccessTokens(first, second);
    this.reloadForm();
  }

  async handleTokenChange(value: string): Promise<void> {
    const token = value.trim();
    if (!token) return;

    setToken(token);
    this.profile = undefined;
    this.error = undefined;
    await this.loadProfile();
  }

  async handleLogout(): Promise<void> {
    clearToken();
    this.profile = undefined;
    this.error = undefined;
    this.reloadForm();
  }
}
