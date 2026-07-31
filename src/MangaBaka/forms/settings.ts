/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import {
  ButtonRow,
  type Cookie,
  Form,
  InputRow,
  LabelRow,
  NavigationRow,
  OAuthButtonRow,
  Section,
  WebViewRow,
} from "@paperback/types";

import {
  type Envelope,
  LOGIN_URL,
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
  setSessionCookies,
  setToken,
  swapAccessTokens,
} from "../network";

// The web view row is hosted by the root form, which is the only place one is
// known to work; pushed forms appear to render it inert.
export class SettingsForm extends Form {
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
            value: "",
            isSecureEntry: true,
            onValueChange: Application.Selector(this as SettingsForm, "handleTokenChange"),
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
      Section({ id: "oauth", footer: "Opens mangabaka.org to authorise this extension." }, [
        NavigationRow("oauth", { title: "Log in with MangaBaka", form: new OAuthForm(this) }),
      ]),
    ];
  }

  reload(): void {
    this.reloadForm();
  }

  async handleWebViewLogin(cookies: Cookie[]): Promise<void> {
    setSessionCookies(cookies);
    this.reloadForm();
  }

  async handleWebViewCancel(): Promise<void> {
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

// Hosts the login row and nothing else: no lifecycle hook and no request runs
// here, so the form is inert while the login web view opens and closes over it.
class OAuthForm extends Form {
  private readonly parent: SettingsForm;

  constructor(parent: SettingsForm) {
    super();
    this.parent = parent;
  }

  override getSections() {
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
          onSuccess: Application.Selector(this as OAuthForm, "handleOAuthSuccess"),
        }),
      ]),
    ];
  }

  async handleOAuthSuccess(first: string, second: string): Promise<void> {
    setAccessTokens(first, second);
    this.parent.reload();
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
        LabelRow("method", {
          title: "Signed in with",
          subtitle: this.profile?.auth_type ?? "Loading...",
        }),
      ]),
    ];
  }
}
