#!/usr/bin/env node
/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

/*
 * Standalone, dependency-free verifier for the Mangago reader page-list walk.
 *
 * It reproduces the extension's real logic against the LIVE site so you can
 * prove a windowed numeric chapter yields ALL pages (not just the first 5):
 *   1. tries www.mangago.me, then the mirror hosts (www.mangago.zone,
 *      www.youhim.me) for the chapter, and uses whichever serves the reader;
 *   2. decrypts page 1's imgsrcs (AES-CBC, zero-padded) using the key/iv from
 *      the sojson.v4-obfuscated chapter.js;
 *   3. reads _multimode / total_pages / the curl template / next_url;
 *   4. if windowed (_multimode="1"), WALKS the sub-pages on the SAME host that
 *      served page 1 (following next_url, then the curl template), decrypting
 *      each and accumulating the image count;
 *   5. prints "collected N / total_pages" and PASS/FAIL.
 *
 * Run it where mangago is reachable (it cannot run from the sandboxed agent
 * environment, whose network policy blocks all non-allowlisted egress):
 *
 *   node scripts/verify-mangago-walk.mjs /chapter/55472/2239666/
 *   node scripts/verify-mangago-walk.mjs https://www.mangago.zone/chapter/49782/1402631/
 *   node scripts/verify-mangago-walk.mjs /read-manga/<slug>/uu/<chapter>/pg-1/
 *
 * Requires Node 18+ (global fetch + node:crypto). No npm install needed.
 *
 * NOTE: image counting does NOT need the char-unscramble step — unscrambling
 * only reorders characters and strips a few key digits, so the number of
 * comma-separated image URLs is invariant. We therefore decrypt and count,
 * which keeps the verifier simple and avoids depending on the descramble key.
 */

import { createDecipheriv } from "node:crypto";

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const READER_MIRROR_HOSTS = [
  "https://www.mangago.me",
  "https://www.mangago.zone",
  "https://www.youhim.me",
];

function isNumericChapter(pathname) {
  return /^\/chapter\/\d+\/\d+/.test(pathname);
}

async function fetchPage(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": DESKTOP_UA,
      cookie: "_m_superu=1",
      referer: "https://www.mangago.me/",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  const text = await res.text();
  return { status: res.status, finalUrl: res.url || url, text };
}

function extractImgsrcs(html) {
  return /var\s+imgsrcs\s*=\s*["']([^"']+)["']/.exec(html)?.[1];
}
function extractMultimode(html) {
  return /_multimode\s*=\s*["']([^"']*)["']/.exec(html)?.[1] ?? "";
}
function extractTotalPages(html) {
  return Number(/total_pages\s*=\s*["']?(\d+)/.exec(html)?.[1] ?? 0) || 0;
}
function extractCurlTemplate(html) {
  return /<input[^>]*id=["']curl["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1]?.trim();
}
function extractNextUrl(html) {
  const anchor =
    /<a\b(?=[^>]*class=["'][^"']*next_page[^"']*["'])[^>]*href=["']([^"']+)["']/i.exec(html)?.[1] ??
    /<a\b(?=[^>]*id=["']pic_container["'])[^>]*href=["']([^"']+)["']/i.exec(html)?.[1];
  if (anchor) return anchor.trim();
  const v = /\bnext_url\s*=\s*["']([^"']+)["']/.exec(html)?.[1]?.trim();
  return v && v !== "#" && !/^javascript:/i.test(v) ? v : undefined;
}
function extractChapterJsUrl(html) {
  return (
    html.match(/<script\b[^>]+src=["']([^"']*chapter\.js[^"']*)["'][^>]*>/i)?.[1] ??
    html.match(/src=["']([^"']*chapter\.js[^"']*)["']/i)?.[1]
  );
}

function sojsonV4Decode(jsf) {
  if (!jsf.startsWith("['sojson.v4']")) throw new Error("not sojson.v4");
  if (jsf.length < 299) throw new Error("sojson input too short");
  const argsStr = jsf.slice(240, jsf.length - 59);
  const parts = argsStr.split(/[a-zA-Z]+/g).filter(Boolean);
  return parts.map((x) => String.fromCharCode(Number(x))).join("");
}
function findHex(js, variable) {
  return new RegExp(
    `var\\s+${variable}\\s*=\\s*CryptoJS\\.enc\\.Hex\\.parse\\(["']([0-9a-fA-F]+)["']\\)`,
  ).exec(js)?.[1];
}

function aesCbcZeroPadDecrypt(b64, keyHex, ivHex) {
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const ct = Buffer.from(b64, "base64");
  if (ct.length === 0 || ct.length % 16 !== 0) {
    throw new Error(`ciphertext length ${ct.length} not a multiple of 16`);
  }
  const algo =
    key.length === 16 ? "aes-128-cbc" : key.length === 24 ? "aes-192-cbc" : "aes-256-cbc";
  const decipher = createDecipheriv(algo, key, iv);
  decipher.setAutoPadding(false); // zero padding, not PKCS#7
  let out = Buffer.concat([decipher.update(ct), decipher.final()]);
  let end = out.length;
  while (end > 0 && out[end - 1] === 0) end--; // strip trailing zero pad
  return out.subarray(0, end).toString("utf8");
}

// Count the image URLs in a decrypted (still char-scrambled) imgsrcs blob.
// Comma count is invariant under the unscramble, so this equals the real count.
function countImages(decrypted) {
  return decrypted
    .replace(/\s+$/g, "")
    .replace(/,+$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean).length;
}

function log(...a) {
  console.log(...a);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: node scripts/verify-mangago-walk.mjs <chapter-path-or-url>");
    process.exit(2);
  }
  const path = arg.startsWith("http") ? new URL(arg).pathname : arg;
  const numeric = isNumericChapter(path);

  log(`\n=== Mangago walk verifier ===`);
  log(`chapter path: ${path}  (${numeric ? "numeric /chapter/" : "read-manga"})\n`);

  // 1) Find a host that serves the reader.
  const hostsToTry = numeric
    ? READER_MIRROR_HOSTS
    : ["https://www.mangago.me", ...READER_MIRROR_HOSTS];
  let serving = null;
  let page1 = null;
  for (const host of hostsToTry) {
    const url = `${host}${path}`;
    try {
      const r = await fetchPage(url);
      const has = !!extractImgsrcs(r.text);
      log(`  ${url}\n    HTTP ${r.status}  imgsrcs:${has ? "YES" : "no"}  size:${r.text.length}`);
      if (r.status === 200 && has && !serving) {
        serving = new URL(r.finalUrl).origin;
        page1 = r;
      }
    } catch (e) {
      log(`  ${url}\n    ERROR ${e.message}`);
    }
  }
  if (!page1) {
    log(`\nRESULT: FAIL — no host returned a reader page with imgsrcs.\n`);
    process.exit(1);
  }
  log(`\n  -> serving host: ${serving}\n`);

  // 2) chapter.js -> AES key/iv
  const jsSrc = extractChapterJsUrl(page1.text);
  if (!jsSrc) throw new Error("chapter.js URL not found");
  const jsUrl = new URL(jsSrc, serving).toString();
  const obf = (await fetchPage(jsUrl)).text;
  const deobf = sojsonV4Decode(obf);
  const keyHex = findHex(deobf, "key");
  const ivHex = findHex(deobf, "iv");
  if (!keyHex || !ivHex) throw new Error("AES key/iv not found in chapter.js");

  // 3) page 1
  const multimode = extractMultimode(page1.text);
  const totalPages = extractTotalPages(page1.text);
  const curl = extractCurlTemplate(page1.text);
  const page1Count = countImages(aesCbcZeroPadDecrypt(extractImgsrcs(page1.text), keyHex, ivHex));
  log(`  _multimode = "${multimode}"   total_pages = ${totalPages}`);
  log(`  curl template = ${curl ?? "(none)"}`);
  log(`  page 1 images = ${page1Count}\n`);

  if (multimode !== "1") {
    log(`  Full reader (not windowed): page 1 holds the whole chapter.`);
    const pass = totalPages === 0 || page1Count >= totalPages;
    log(
      `\nRESULT: ${pass ? "PASS" : "WARN"} — ${page1Count} images${
        totalPages ? ` / total_pages ${totalPages}` : ""
      }${pass ? "" : " (page 1 < total_pages; would walk)"}.\n`,
    );
    process.exit(pass ? 0 : 1);
  }

  // 4) windowed walk on the SAME serving host
  log(`  Windowed reader -> walking sub-pages on ${serving} ...`);
  let collected = page1Count;
  let html = page1.text;
  let currentUrl = `${serving}${path}`;
  const visited = new Set([new URL(currentUrl).pathname]);
  let expected = page1Count + 1;
  let safety = Math.max(totalPages, 50) + 25;

  while (safety-- > 0 && (totalPages === 0 || collected < totalPages)) {
    let nextUrl;
    const nextHref = extractNextUrl(html);
    if (nextHref) {
      const resolved = new URL(nextHref, currentUrl);
      // stop if the next link crosses into another chapter
      const sameChapter =
        resolved.pathname.replace(/\/\d+\/?$/, "") ===
          new URL(currentUrl).pathname.replace(/\/\d+\/?$/, "") ||
        /\/(\d+)\/?$/.test(resolved.pathname);
      if (resolved.origin === serving && sameChapter) nextUrl = resolved.toString();
    }
    if (!nextUrl && curl) {
      const tmplPath = new URL(curl.replace("{page}", String(expected)), serving).pathname;
      nextUrl = `${serving}${tmplPath}`;
    }
    if (!nextUrl) {
      log(`    no usable next link -> stop`);
      break;
    }
    const key = new URL(nextUrl).pathname;
    if (visited.has(key)) {
      expected++;
      continue;
    }
    visited.add(key);

    const r = await fetchPage(nextUrl);
    const blob = extractImgsrcs(r.text);
    const n = blob ? countImages(aesCbcZeroPadDecrypt(blob, keyHex, ivHex)) : 0;
    log(`    ${key}  HTTP ${r.status}  +${n} images  (running ${collected + n})`);
    if (r.status !== 200 || n === 0) {
      log(`    sub-page returned no images -> stop`);
      break;
    }
    collected += n;
    html = r.text;
    currentUrl = nextUrl;
    expected = collected + 1;
  }

  const pass = totalPages > 0 && collected >= totalPages;
  log(
    `\nRESULT: ${pass ? "PASS" : "FAIL"} — collected ${collected} / total_pages ${totalPages} from ${serving}.`,
  );
  if (!pass) {
    log(
      `If this stops at ~${page1Count}, the walk is not reaching the mirror sub-pages; capture the host on the failing line above.`,
    );
  }
  log("");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(`\nverifier error: ${e?.stack || e}`);
  process.exit(1);
});
