/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

type WebCrypto = {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
  subtle?: {
    digest?: (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>;
  };
};

export interface PkceSession {
  verifier: string;
  challenge: string;
  state: string;
}

const VERIFIER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const webCrypto = (): WebCrypto | undefined => (globalThis as { crypto?: WebCrypto }).crypto;

const randomBytes = (length: number): Uint8Array => {
  const crypto = webCrypto();
  if (crypto?.getRandomValues == undefined) {
    throw new Error("This device does not provide secure randomness for MangaBaka login.");
  }

  return crypto.getRandomValues(new Uint8Array(length));
};

const base64UrlEncode = (bytes: Uint8Array): string => {
  let result = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const group = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    result += BASE64URL_ALPHABET[(group >> 18) & 63];
    result += BASE64URL_ALPHABET[(group >> 12) & 63];
    if (second != undefined) result += BASE64URL_ALPHABET[(group >> 6) & 63];
    if (third != undefined) result += BASE64URL_ALPHABET[group & 63];
  }

  return result;
};

const randomVerifier = (length = 64): string => {
  let verifier = "";
  for (const byte of randomBytes(length)) {
    verifier += VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length];
  }
  return verifier;
};

export const createPkceSession = async (): Promise<PkceSession> => {
  const crypto = webCrypto();
  if (crypto?.subtle?.digest == undefined) {
    throw new Error("This device does not provide SHA-256 for MangaBaka login.");
  }

  const verifier = randomVerifier();
  const verifierBytes = Uint8Array.from(verifier, (character) => character.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", verifierBytes);

  return {
    verifier,
    challenge: base64UrlEncode(new Uint8Array(digest)),
    state: base64UrlEncode(randomBytes(16)),
  };
};
