/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { ButtonRow, Form, InputRow, LabelRow, Section } from "@paperback/types";

import type { Envelope, Profile } from "../models";
import { clearToken, getToken, makeRequest, setToken } from "../network";

export class SettingsForm extends Form {
  private profile?: Profile;
  private error?: string;

  override formWillAppear(): void {
    if (!getToken()) return;

    makeRequest<Envelope<Profile>>("/v1/my/profile", { needsAuth: true })
      .then((response) => {
        this.profile = response.data;
        this.error = undefined;
      })
      .catch((error: Error) => {
        this.error = error.message;
      })
      .finally(() => {
        this.reloadForm();
      });
  }

  override getSections() {
    if (!getToken()) {
      return [
        Section(
          {
            id: "login",
            header: "Account",
            footer:
              "Create a personal access token on mangabaka.org (Settings → API) and paste it here. It starts with mb-.",
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

  async handleTokenChange(value: string): Promise<void> {
    const token = value.trim();
    if (!token) return;

    setToken(token);
    this.profile = undefined;
    this.error = undefined;
    this.formWillAppear();
    this.reloadForm();
  }

  async handleLogout(): Promise<void> {
    clearToken();
    this.profile = undefined;
    this.error = undefined;
    this.reloadForm();
  }
}
