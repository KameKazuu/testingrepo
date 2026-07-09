/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { URL } from "@paperback/types";

import { API_URL, type ChapterPageEdge, MIRROR_HOSTS, type PagesData } from "../models";

// chapterPages is gated behind a rotating request signature (aaReq), reversed
// from the site bundle (buildId 12):
//   key     = partA XOR partB   (partB is inlined in the reader shell as window.__aaCrypto)
//   iv      = SHA-256(`${epoch}:${buildId}:${queryHash}:${ts}`)[0:12]
//   payload = { v: 1, ts, epoch, buildId, qh: queryHash }
//   aaReq   = base64(0x01 | iv | AES-GCM(key, iv, payload))
// aaReq travels inside the extensions object, and the response payload comes
// back AES-GCM-encrypted in a `tobeparsed` field, decrypted with the same key.
const PART_A_HEX = "78ebe40583e4f360cd9f56926b775a780054367c826123dcd0577a231eee4e73";
const BUILD_ID = "12";
const SECRET_PREFIX = "Xot36i3lK3";
const TS_BUCKET_MS = 5 * 60 * 1000;
const PAGE_SOURCE_LIMIT = 10;

// $limit is required and `manga` must be selected: the resolver assigns
// manga.countryOfOrigin but only builds that container when the field is asked
// for, and returns null pages otherwise.
const PAGES_QUERY = `query($mangaId: String!, $translationType: VaildTranslationTypeMangaEnumType!, $chapterString: String!, $limit: Int!, $offset: Int) {
  chapterPages(mangaId: $mangaId, translationType: $translationType, chapterString: $chapterString, limit: $limit, offset: $offset) {
    edges { pictureUrlHead pictureUrls }
    manga { _id countryOfOrigin }
  }
}`;

interface Bootstrap {
  epoch: number;
  partB: string;
  switchAt: number;
}

let cachedBootstrap: Bootstrap | undefined;

export async function pageListViaApi(
  mangaId: string,
  chapterString: string,
  translationType: string,
): Promise<PagesData | undefined> {
  try {
    const bootstrap = await getBootstrap();
    if (!bootstrap) return undefined;

    const key = await deriveSigningKey(bootstrap.partB);
    const queryHash = await sha256Hex(PAGES_QUERY);
    const aaReq = await buildAaReq(key, bootstrap.epoch, queryHash);

    const url = new URL(API_URL)
      .setQueryItem("query", PAGES_QUERY)
      .setQueryItem(
        "variables",
        JSON.stringify({
          mangaId,
          translationType,
          chapterString,
          limit: PAGE_SOURCE_LIMIT,
          offset: 0,
        }),
      )
      .setQueryItem(
        "extensions",
        JSON.stringify({ persistedQuery: { version: 1, sha256Hash: queryHash }, aaReq }),
      )
      .toString();

    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
    if (response.status !== 200) return undefined;

    const parsed = JSON.parse(Application.arrayBufferToUTF8String(buffer)) as {
      data?: { chapterPages?: PagesData["chapterPages"]; tobeparsed?: string } | null;
    };

    let chapterPages = parsed.data?.chapterPages ?? undefined;
    if (!chapterPages?.edges?.length && parsed.data?.tobeparsed) {
      const decrypted = (await decryptTobeParsed(parsed.data.tobeparsed, key)) as
        | { chapterPages?: PagesData["chapterPages"]; edges?: ChapterPageEdge[] }
        | undefined;
      chapterPages =
        decrypted?.chapterPages ?? (decrypted?.edges ? { edges: decrypted.edges } : undefined);
    }

    return chapterPages?.edges?.length ? { chapterPages } : undefined;
  } catch {
    return undefined;
  }
}

// partB and epoch are inlined in the current build's reader shell as
// window.__aaCrypto; only that mirror ships it, so scan the mirrors for it.
async function getBootstrap(): Promise<Bootstrap | undefined> {
  const now = Date.now();
  if (cachedBootstrap && cachedBootstrap.switchAt > now) return cachedBootstrap;

  for (const host of MIRROR_HOSTS) {
    try {
      const [response, buffer] = await Application.scheduleRequest({
        url: `https://${host}/client-crypto/v1/bootstrap?buildId=${BUILD_ID}`,
        method: "GET",
      });
      if (response.status !== 200) continue;

      const match = Application.arrayBufferToUTF8String(buffer).match(
        /window\.__aaCrypto\s*=\s*(\{.*?\})\s*;/,
      );
      if (!match?.[1]) continue;

      const json = JSON.parse(match[1]) as { epoch?: number; partB?: string; switchAt?: number };
      if (typeof json.epoch !== "number" || typeof json.partB !== "string") continue;

      cachedBootstrap = {
        epoch: json.epoch,
        partB: json.partB,
        switchAt: typeof json.switchAt === "number" ? json.switchAt : now + TS_BUCKET_MS,
      };
      return cachedBootstrap;
    } catch {
      continue;
    }
  }
  return undefined;
}

async function deriveSigningKey(partB: string): Promise<CryptoKey> {
  const a = hexToBytes(PART_A_HEX);
  const b = base64ToBytes(partB);
  if (b.length < 32) throw new Error("part B too short");

  const raw = new Uint8Array(32);
  for (let i = 0; i < 32; i++) raw[i] = (b[i] ?? 0) ^ (a[i % a.length] ?? 0);

  return crypto.subtle.importKey("raw", toBuffer(raw), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function buildAaReq(key: CryptoKey, epoch: number, queryHash: string): Promise<string> {
  const ts = Math.floor(Date.now() / TS_BUCKET_MS) * TS_BUCKET_MS;
  const payload = JSON.stringify({ v: 1, ts, epoch, buildId: BUILD_ID, qh: queryHash });

  const iv = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      stringToBuffer(`${epoch}:${BUILD_ID}:${queryHash}:${ts}`),
    ),
  ).slice(0, 12);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toBuffer(iv) },
      key,
      stringToBuffer(payload),
    ),
  );

  const out = new Uint8Array(13 + cipher.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(cipher, 13);
  return bytesToBase64(out);
}

async function decryptTobeParsed(value: string, signingKey: CryptoKey): Promise<unknown> {
  const bytes = base64ToBytes(value);
  const version = bytes[0] ?? 1;
  const iv = toBuffer(bytes, 1, 13);
  const cipher = toBuffer(bytes, 13, bytes.length);

  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, signingKey, cipher);
    return JSON.parse(Application.arrayBufferToUTF8String(plain));
  } catch {
    const legacyRaw = await crypto.subtle.digest(
      "SHA-256",
      stringToBuffer(`${SECRET_PREFIX}:v${version}`),
    );
    const legacyKey = await crypto.subtle.importKey("raw", legacyRaw, { name: "AES-GCM" }, false, [
      "decrypt",
    ]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, legacyKey, cipher);
    return JSON.parse(Application.arrayBufferToUTF8String(plain));
  }
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64[b0 >> 2];
    out += BASE64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : BASE64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : BASE64[b2 & 63];
  }
  return out;
}

function base64ToBytes(value: string): Uint8Array {
  const decoded = Application.base64Decode(value);
  return typeof decoded === "string" ? stringToBytes(decoded) : new Uint8Array(decoded);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function stringToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i);
  return bytes;
}

function stringToBuffer(value: string): ArrayBuffer {
  return toBuffer(stringToBytes(value));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", stringToBuffer(value)));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// WebCrypto wants a concrete ArrayBuffer, not a possibly-shared/offset view.
function toBuffer(bytes: Uint8Array, start = 0, end = bytes.length): ArrayBuffer {
  const out = new Uint8Array(end - start);
  out.set(bytes.subarray(start, end));
  return out.buffer;
}
