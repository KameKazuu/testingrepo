/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

import { URL } from "@paperback/types";

import { API_URL, cryptoHostOrder, PAGES_QUERY, type PagesData } from "../models";

// The API gates chapterPages behind a rotating request signature (aaReq); a
// missing/invalid one returns AA_CRYPTO_MISSING. The site computes it in JS
// from a build-constant "part A" XOR a rotating "part B" (inlined in the reader
// shell as window.__aaCrypto), so we reproduce it here and query the API
// directly — no reader page, no Cloudflare, no WebView.
//
// Reversed from the site bundle (buildId 12):
//   key      = partA(32 bytes) XOR partB(32 bytes from bootstrap)
//   ts       = floor(now / 5min) * 5min
//   payload  = {v:1, ts, epoch, buildId, qh}
//   iv       = SHA-256(`${epoch}:${buildId}:${qh}:${ts}`)[0:12]
//   aaReq    = base64( 0x01 | iv | AES-GCM(key, iv, payload) )
const PART_A_HEX = "78ebe40583e4f360cd9f56926b775a780054367c826123dcd0577a231eee4e73";
const BUILD_ID = "12";
// Legacy key prefix, used as a fallback when decrypting a `tobeparsed` response.
const SECRET_PREFIX = "Xot36i3lK3";
const TS_BUCKET_MS = 5 * 60 * 1000;

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

    // Send our own chapterPages query text (Apollo APQ) and sign for its hash,
    // rather than a site-side persisted-query id. A stale/foreign id resolves to
    // a server query whose variables (e.g. $limit) we don't control; hashing our
    // own query guarantees the server runs exactly these three variables.
    const queryHash = await sha256Hex(PAGES_QUERY);
    const aaReq = await buildAaReq(key, bootstrap.epoch, queryHash);

    // aaReq travels *inside* the extensions object (extensions.aaReq), not as a
    // separate query parameter — the API reads it from there and returns
    // AA_CRYPTO_MISSING otherwise.
    const url = new URL(API_URL)
      .setQueryItem("query", PAGES_QUERY)
      .setQueryItem("variables", JSON.stringify({ mangaId, translationType, chapterString }))
      .setQueryItem(
        "extensions",
        JSON.stringify({ persistedQuery: { version: 1, sha256Hash: queryHash }, aaReq }),
      )
      .toString();

    const [response, buffer] = await Application.scheduleRequest({ url, method: "GET" });
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
    if (parsed.data?.tobeparsed) {
      data = (await decryptTobeParsed(parsed.data.tobeparsed, key)) as typeof data;
    }

    if (!data?.chapterPages?.edges?.length) return undefined;
    return { chapterPages: data.chapterPages };
  } catch (error) {
    console.log(`[AM] api page fetch failed: ${String(error)}`);
    return undefined;
  }
}

// The site's client-crypto material is inlined in the reader shell's <head> as
//   window.__aaCrypto={"epoch":…,"switchAt":…,"partB":"<32-byte b64 key>"}
// — not a JSON endpoint. Only the current build (mkissa.to's SvelteKit app)
// ships it; the legacy allmanga.to Nuxt shell doesn't, so we scan each host
// until one yields it. These non-reader routes are served 200 with no
// Cloudflare challenge. Cached until switchAt so we don't refetch each chapter.
async function getBootstrap(): Promise<Bootstrap | undefined> {
  const now = Date.now();
  if (cachedBootstrap && cachedBootstrap.switchAt > now) return cachedBootstrap;

  for (const host of cryptoHostOrder()) {
    try {
      const [response, buffer] = await Application.scheduleRequest({
        url: `${host}/client-crypto/v1/bootstrap?buildId=${BUILD_ID}`,
        method: "GET",
      });
      if (response.status !== 200) {
        console.log(`[AM] bootstrap ${host} HTTP ${response.status}`);
        continue;
      }
      const html = Application.arrayBufferToUTF8String(buffer);
      const match = html.match(/window\.__aaCrypto\s*=\s*(\{.*?\})\s*;/);
      if (!match?.[1]) {
        console.log(`[AM] bootstrap ${host} no __aaCrypto`);
        continue;
      }
      const json = JSON.parse(match[1]) as {
        epoch?: number;
        partB?: string;
        switchAt?: number;
      };
      if (typeof json.epoch !== "number" || typeof json.partB !== "string") {
        console.log(`[AM] bootstrap ${host} missing epoch/partB`);
        continue;
      }
      cachedBootstrap = {
        epoch: json.epoch,
        partB: json.partB,
        switchAt: typeof json.switchAt === "number" ? json.switchAt : now + TS_BUCKET_MS,
      };
      console.log(`[AM] bootstrap ${host} ok epoch=${json.epoch}`);
      return cachedBootstrap;
    } catch (error) {
      console.log(`[AM] bootstrap ${host} failed: ${String(error)}`);
    }
  }
  return undefined;
}

// key = partA XOR partB (both 32 bytes), imported for AES-GCM.
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

  const ivDigest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      stringToBuffer(`${epoch}:${BUILD_ID}:${queryHash}:${ts}`),
    ),
  );
  const iv = ivDigest.slice(0, 12);
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

// A `tobeparsed` response is 0x01 | 12-byte IV | AES-GCM ciphertext, decrypted
// with the same signing key. Older payloads use a legacy per-version key, so
// fall back to that if the primary key fails.
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

// A standalone ArrayBuffer of bytes[start, end) — WebCrypto wants a concrete
// ArrayBuffer, not a possibly-shared/offset typed-array view.
function toBuffer(bytes: Uint8Array, start = 0, end = bytes.length): ArrayBuffer {
  const out = new Uint8Array(end - start);
  out.set(bytes.subarray(start, end));
  return out.buffer;
}
