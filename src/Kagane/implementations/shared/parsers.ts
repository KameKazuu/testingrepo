/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { URL } from "@paperback/types";

import { BASE_URL, DOMAIN_KEY, DOMAIN_OPTIONS } from "./models";

export const getBaseUrl = (): string => {
  const host = Application.getState(DOMAIN_KEY);
  return typeof host === "string" && DOMAIN_OPTIONS.some((option) => option.id === host)
    ? `https://${host}`
    : BASE_URL;
};

export const parseSeriesUrl = (text: string): string | undefined => {
  if (!/^(?:https?:\/\/)?(?:www\.)?kagane\./i.test(text)) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      !DOMAIN_OPTIONS.some((option) => option.id === host) ||
      url.username ||
      url.password ||
      url.port
    )
      return undefined;
    const match = /^\/series\/([^/]+)(?:\/[^/]*)?\/?$/.exec(url.path);
    const id = match ? decodeURIComponent(match[1]) : "";
    return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
};
