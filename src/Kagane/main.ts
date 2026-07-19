/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import type { Cookie, Extension, MangaProviding, Request } from "@paperback/types";
import { BasicRateLimiter, CookieStorageInterceptor } from "@paperback/types";

import { ChapterProvider } from "./implementations/chapter-providing/main";
import { DiscoverProvider } from "./implementations/discover-section/main";
import { MangaProvider } from "./implementations/manga/main";
import { SearchProvider } from "./implementations/search-results/main";
import { SettingsFormProvider } from "./implementations/settings-form/main";
import { applyMixins } from "./implementations/shared/utils";
import { completeBypassGate, KaganeInterceptor } from "./services/network";

export interface KaganeImplementation
  extends SearchProvider, MangaProvider, ChapterProvider, DiscoverProvider, SettingsFormProvider {}

export class KaganeExtension implements Omit<Extension, keyof MangaProviding> {
  cookieStorageInterceptor = new CookieStorageInterceptor({
    storage: "stateManager",
  });
  globalRateLimiter = new BasicRateLimiter("kagane-rate-limiter", {
    numberOfRequests: 8,
    bufferInterval: 1,
    ignoreImages: true,
  });
  kaganeInterceptor = new KaganeInterceptor("kagane-interceptor");

  async initialise(): Promise<void> {
    this.cookieStorageInterceptor.registerInterceptor();
    this.kaganeInterceptor.registerInterceptor();
    this.globalRateLimiter.registerInterceptor();
  }

  async saveCloudflareBypassCookies(cookies: Cookie[]): Promise<void> {
    await this.cloudflareBypassCompleted({ url: "", method: "GET" }, cookies, {});
  }

  async cloudflareBypassCompleted(
    _request: Request,
    cookies: Cookie[],
    _localStorage: Record<string, string>,
  ): Promise<void> {
    for (const cookie of cookies) {
      if (
        cookie.name.startsWith("cf") ||
        cookie.name.startsWith("_cf") ||
        cookie.name.startsWith("__cf")
      ) {
        this.cookieStorageInterceptor.setCookie(cookie);
      }
    }
    // Release any sibling requests waiting on this bypass so they retry on the
    // fresh clearance instead of opening another WebView.
    completeBypassGate();
  }
}

applyMixins(KaganeExtension, [
  SearchProvider,
  MangaProvider,
  ChapterProvider,
  DiscoverProvider,
  SettingsFormProvider,
]);

export const Kagane = new KaganeExtension();
