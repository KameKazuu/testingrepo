/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

// The API gates chapterPages behind a rotating request signature (aaReq),
// reversed from the site bundle (buildId 13):
//   key     = partA XOR partB   (partB is inlined in the reader shell as window.__aaCrypto)
//   iv      = SHA-256(`${epoch}:${buildId}:${queryHash}:${ts}`)[0:12]
//   payload = { v: 1, ts, epoch, buildId, qh: queryHash }
//   aaReq   = base64(0x01 | iv | AES-GCM(key, iv, payload))
// aaReq travels inside the extensions object, and the response payload comes
// back AES-GCM-encrypted in a `tobeparsed` field, decrypted with the same key.
// partA and buildId are baked into the site build, so both change on a rebuild.
export const BUILD_ID = "13";
export const TS_BUCKET_MS = 5 * 60 * 1000;
const PART_A_HEX = "f5dc46e6f42968c5ed0eab602d6ae8f2107991006f02876947e64fcb75d53da6";
const SECRET_PREFIX = "Xot36i3lK3";

// key = partA XOR partB (both 32 bytes), imported for AES-GCM.
export async function deriveSigningKey(partB: string): Promise<CryptoKey> {
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

export async function buildAaReq(
  key: CryptoKey,
  epoch: number,
  queryHash: string,
): Promise<string> {
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

export async function decryptTobeParsed(value: string, signingKey: CryptoKey): Promise<unknown> {
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

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", stringToBuffer(value)));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
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

// WebCrypto wants a concrete ArrayBuffer, not a possibly-shared/offset view.
function toBuffer(bytes: Uint8Array, start = 0, end = bytes.length): ArrayBuffer {
  const out = new Uint8Array(end - start);
  out.set(bytes.subarray(start, end));
  return out.buffer;
}
