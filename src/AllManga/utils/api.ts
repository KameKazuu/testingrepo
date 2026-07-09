/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { URL, type Request } from "@paperback/types";

import {
  API_URL,
  CHAPTER_PAGES_HASH,
  PAGES_QUERY,
  type PagesData,
  TOBEPARSED_KEY_PREFIX,
} from "../models";

// Fetch chapter pages straight from the allanime API — no reader page, so no
// Cloudflare and no WebView. The API serves a direct client that sends the
// persisted-query hash; only the browser front-ends need the anti-bot
// signature. Tries the persisted GET first (what the live site uses), then the
// full query text in case the hash isn't registered for us. Returns undefined
// on any failure so the caller can fall back to the WebView capture.
export async function pageListViaApi(
  mangaId: string,
  chapterString: string,
  translationType: string,
): Promise<PagesData | undefined> {
  const variables = { mangaId, translationType, chapterString };

  const attempts: Request[] = [
    {
      url: new URL(API_URL)
        .setQueryItem("variables", JSON.stringify(variables))
        .setQueryItem(
          "extensions",
          JSON.stringify({ persistedQuery: { version: 1, sha256Hash: CHAPTER_PAGES_HASH } }),
        )
        .toString(),
      method: "GET",
    },
    {
      url: API_URL,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: PAGES_QUERY, variables }),
    },
  ];

  for (const request of attempts) {
    try {
      const pages = await requestPages(request);
      if (pages?.chapterPages?.edges?.length) return pages;
    } catch (error) {
      console.log(`[AM] api page attempt failed: ${String(error)}`);
    }
  }

  return undefined;
}

async function requestPages(request: Request): Promise<PagesData | undefined> {
  const [response, buffer] = await Application.scheduleRequest(request);
  if (response.status !== 200) {
    console.log(`[AM] api pages HTTP ${response.status}`);
    return undefined;
  }

  const parsed = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as {
    data?: { chapterPages?: PagesData["chapterPages"]; tobeparsed?: string } | null;
    errors?: { message?: string }[];
  };

  if (parsed.errors?.length) {
    console.log(`[AM] api pages error: ${parsed.errors[0]?.message ?? "unknown"}`);
    return undefined;
  }

  let data: { chapterPages?: PagesData["chapterPages"] } | undefined = parsed.data ?? undefined;

  // Newer responses ship the payload AES-GCM-encrypted under `tobeparsed`.
  if (parsed.data?.tobeparsed) {
    data = (await decryptTobeParsed(parsed.data.tobeparsed)) as typeof data;
  }

  if (!data?.chapterPages) return undefined;
  return { chapterPages: data.chapterPages };
}

// Mirrors the site's own decode: base64 -> [versionByte | 12-byte IV | GCM
// ciphertext+tag], key = SHA-256("Xot36i3lK3:v" + versionByte), AES-GCM.
async function decryptTobeParsed(value: string): Promise<unknown> {
  const decoded = Application.base64Decode(value);
  const bytes: Uint8Array =
    typeof decoded === "string" ? stringToBytes(decoded) : new Uint8Array(decoded);

  const version = bytes[0] ?? 0;
  const iv = toBuffer(bytes, 1, 13);
  const cipherText = toBuffer(bytes, 13, bytes.length);

  const keyBytes = await crypto.subtle.digest(
    "SHA-256",
    toBuffer(stringToBytes(`${TOBEPARSED_KEY_PREFIX}${version}`)),
  );
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherText);

  return JSON.parse(Application.arrayBufferToUTF8String(plain));
}

function stringToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
  return bytes;
}

// A standalone ArrayBuffer of bytes[start, end) — WebCrypto wants a concrete
// ArrayBuffer, not a possibly-shared/offset typed-array view.
function toBuffer(bytes: Uint8Array, start = 0, end = bytes.length): ArrayBuffer {
  const out = new Uint8Array(end - start);
  out.set(bytes.subarray(start, end));
  return out.buffer;
}
