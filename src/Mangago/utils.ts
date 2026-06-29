import { CloudflareError } from "@paperback/types";

import { DESKTOP_USER_AGENT, DOMAIN, READER_MIRROR, READER_MIRROR_FALLBACK } from "./models";
import { fetchText, fetchTextWithUrl } from "./network";

// ── Caches: chapter.js (deobfuscated) and final page URLs. These stop the
//    extension from refetching on every retry/re-open, which is the main
//    source of redundant requests that trip the 5/30 rate limit. ──
const mangagoPageUrlsCache = new Map<string, string[]>();
const chapterJsCache = new Map<string, string>();

// Persistent (cross-launch) cache for the deobfuscated chapter.js, keyed by its
// versioned URL (".../chapter.js?895"). The in-memory chapterJsCache above is
// wiped on every app launch, so the first chapter opened each launch otherwise
// re-downloads the ~91 KB script and re-runs sojsonV4Decode before the reader
// can open. Persisting the already-deobfuscated result skips both. The key
// includes the "?<version>", so a version bump auto-misses and refetches.
const CHAPTER_JS_STATE_PREFIX = "mangago-chapterjs:";

// ── CachedRequests-style dedup for reader-page HTML (keyed mirror-independently
//    by path, short TTL). mangago throttles request bursts, and an incomplete
//    chapter is re-walked on re-open (we deliberately don't cache partial page
//    lists). Caching successful reader HTML means a re-walk reuses what already
//    loaded and only re-hits the network for the pages that previously failed —
//    cutting requests and rate-limit pressure. Only successful (imgsrcs-bearing)
//    responses are cached, so a failed page is always retried fresh. ──
const READER_HTML_TTL_MS = 5 * 60 * 1000;
const readerHtmlCache = new Map<string, { html: string; expires: number }>();

const READER_FETCH_MIN_INTERVAL_MS = 350;
let lastReaderFetchAt = 0;

async function paceReaderFetch(): Promise<void> {
  const now = Date.now();
  const waitMs = READER_FETCH_MIN_INTERVAL_MS - (now - lastReaderFetchAt);
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastReaderFetchAt = Date.now();
}

function pathnameKey(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function getCachedReaderHtml(url: string): string | undefined {
  const key = pathnameKey(url);
  const entry = readerHtmlCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    readerHtmlCache.delete(key);
    return undefined;
  }
  return entry.html;
}

function cacheReaderHtml(url: string, html: string): void {
  readerHtmlCache.set(pathnameKey(url), { html, expires: Date.now() + READER_HTML_TTL_MS });
}

// Parse the trailing reader-page position from a numeric image-index URL
// (".../chapter/<mid>/<cid>/<pos>/"). Page 1 (".../chapter/<mid>/<cid>/") has no
// trailing position and returns undefined.
function readerPagePosition(url: string): number | undefined {
  const match = /\/chapter\/\d+\/\d+\/(\d+)\/?$/.exec(pathnameKey(url));
  return match ? Number(match[1]) : undefined;
}

function readMangaPagePosition(url: string): number | undefined {
  const match = /\/pg-(\d+)\/?$/i.exec(pathnameKey(url));
  return match ? Number(match[1]) : undefined;
}

function originOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

function withMirror(url: string, mirror: string): string {
  try {
    const u = new URL(url);
    const m = new URL(mirror);
    u.protocol = m.protocol;
    u.host = m.host;
    return u.toString();
  } catch {
    return url;
  }
}

// True for the legacy numeric reader path "/chapter/<mid>/<cid>/...". These 404
// on www.mangago.me and only resolve on the mirror hosts.
export function isNumericReaderPath(pathname: string): boolean {
  return /^\/chapter\/\d+\/\d+/.test(pathname);
}

// Hosts that actually serve the legacy numeric /chapter/ reader. The site
// round-robins numeric chapter links across these mirrors, and a chapter that
// loaded on one of them serves its whole page-walk from that same host — so when
// a URL already points at one, we keep it instead of snapping back to the
// default mirror.
const READER_MIRROR_HOSTS = [READER_MIRROR, READER_MIRROR_FALLBACK]
  .map((mirror) => {
    try {
      return new URL(mirror).host.toLowerCase();
    } catch {
      return "";
    }
  })
  .filter(Boolean);

function isReaderMirrorHost(host: string): boolean {
  return READER_MIRROR_HOSTS.includes(host.toLowerCase());
}

// Route a reader URL (or bare path) onto a host that actually serves it. The
// chapter list rotates between the read-manga reader (served by www.mangago.me)
// and the numeric reader (served only by the mirror hosts), so we route by path
// instead of forcing one domain — forcing www.mangago.me 404s every numeric
// reader, and forcing a mirror breaks the read-manga reader. Adapts keiyoushi
// PR #16599 (a dedicated reader mirror for /chapter/ paths) to Paperback.
//
// For numeric paths we PRESERVE an already-mirror host (mangago.zone /
// youhim.me) rather than rewriting every numeric URL to the single default
// mirror. The site serves a chapter's entire walk from whichever mirror handed
// out page 1, so if a chapter loaded on youhim.me its sub-pages must keep
// hitting youhim.me — forcing them to mangago.zone (or, worse, leaving them on
// www.mangago.me) is what 404'd the page-walk. Only a numeric URL that is NOT
// already on a mirror (e.g. a stale www.mangago.me library entry) is routed to
// the default mirror.
export function canonicalReaderUrl(url: string): string {
  try {
    const u = new URL(url, DOMAIN);
    if (u.pathname.startsWith("/read-manga/")) {
      return `${DOMAIN}${u.pathname}${u.search}${u.hash}`;
    }
    if (isNumericReaderPath(u.pathname)) {
      const base = isReaderMirrorHost(u.host) ? `${u.protocol}//${u.host}` : READER_MIRROR;
      return `${base}${u.pathname}${u.search}${u.hash}`;
    }
    return url;
  } catch {
    const path = url.startsWith("/") ? url : `/${url}`;
    if (path.startsWith("/read-manga/")) return `${DOMAIN}${path}`;
    if (isNumericReaderPath(path)) return `${READER_MIRROR}${path}`;
    return url;
  }
}

export function absoluteUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `https://www.mangago.me${url}`;
  return `https://www.mangago.me/${url}`;
}

export function extractMangaId(href: string): string {
  try {
    const url = href.startsWith("http") ? new URL(href) : new URL(href, "https://www.mangago.me");
    return url.pathname;
  } catch {
    return href;
  }
}

export function extractImgsrcs(input: string): string | undefined {
  const match = /var\s+imgsrcs\s*=\s*["']([^"']+)["']/.exec(input);
  return match?.[1];
}

export function sojsonV4Decode(jsf: string): string {
  if (!jsf.startsWith("['sojson.v4']")) {
    throw new Error("Obfuscated code is not sojson.v4");
  }

  if (jsf.length < 299) {
    throw new Error("sojson input too short");
  }

  const argsStr = jsf.slice(240, jsf.length - 59);
  const parts = argsStr.split(/[a-zA-Z]+/g).filter(Boolean);

  return parts.map((x) => String.fromCharCode(Number(x))).join("");
}

export function findHexEncodedVariable(input: string, variable: string): string | undefined {
  const regex = new RegExp(
    `var\\s+${variable}\\s*=\\s*CryptoJS\\.enc\\.Hex\\.parse\\(["']([0-9a-fA-F]+)["']\\)`,
  );

  return regex.exec(input)?.[1];
}

export function decodeHex(hex: string): ArrayBuffer {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex length");

  const bytes = new Uint8Array(hex.length / 2);

  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }

  return bytes.buffer;
}

export async function aesCbcDecrypt(
  encrypted: ArrayBuffer,
  keyBytes: ArrayBuffer,
  ivBytes: ArrayBuffer,
): Promise<ArrayBuffer> {
  // Native Web Crypto. `new SubtleCrypto()` is an illegal constructor in JSCore
  // (this threw on every chapter = the broken reader). `crypto.subtle` is the
  // form Paperback's window.crypto polyfill exposes and that shipping inkdex
  // sources (madara) use. No external crypto dependency needed.
  const subtle = crypto.subtle;

  // AES-CBC ciphertext must be a whole number of 16-byte blocks. Bail early with
  // a clear message rather than letting WebCrypto throw an opaque
  // InvalidAccessError on a truncated/corrupt blob.
  if (encrypted.byteLength === 0 || encrypted.byteLength % 16 !== 0) {
    throw new Error(`Invalid ciphertext length ${encrypted.byteLength} (not a multiple of 16)`);
  }

  const cryptoKey = await subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, [
    "encrypt",
    "decrypt",
  ]);

  const ciphertext = new Uint8Array(encrypted);

  // Mangago uses zero-byte padding (keiyoushi: AES/CBC/ZEROBYTEPADDING,
  // Aidoku: NoPadding). WebCrypto AES-CBC only supports PKCS#7 and THROWS on
  // zero-padded data, which silently kills some chapters. We append one
  // synthetic block that decrypts to a valid full PKCS#7 pad block so
  // WebCrypto strips exactly that block, then we strip trailing zeros.
  const lastBlock = ciphertext.slice(ciphertext.length - 16);
  const padBlock = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    padBlock[i] = 0x10 ^ (lastBlock[i] ?? 0);
  }

  const zeroIv = new Uint8Array(16);
  const encryptedPad = new Uint8Array(
    await subtle.encrypt({ name: "AES-CBC", iv: zeroIv.buffer }, cryptoKey, padBlock.buffer),
  );

  const extended = new Uint8Array(ciphertext.length + 16);
  extended.set(ciphertext, 0);
  extended.set(encryptedPad.slice(0, 16), ciphertext.length);

  const decrypted = new Uint8Array(
    await subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, cryptoKey, extended.buffer),
  );

  let end = decrypted.length;
  while (end > 0 && decrypted[end - 1] === 0) end--;

  return decrypted.slice(0, end).buffer;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const decoded = Application.base64Decode(value);

  if (typeof decoded === "string") {
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return bytes.buffer;
  }

  return decoded;
}

function findKeyLocations(js: string): number[] {
  const locations: number[] = [];
  let i = 0;
  const pattern = "str.charAt(";

  while (true) {
    const found = js.indexOf(pattern, i);
    if (found < 0) break;

    let idx = found + pattern.length;

    while (idx < js.length && !/[0-9]/.test(js[idx] ?? "")) idx++;

    const start = idx;

    while (idx < js.length && /[0-9]/.test(js[idx] ?? "")) idx++;

    const num = Number(js.slice(start, idx));

    if (Number.isFinite(num) && !locations.includes(num)) {
      locations.push(num);
    }

    i = idx;
  }

  return locations;
}

function unscrambleChars(chars: string[], keys: number[]): void {
  for (const key of [...keys].reverse()) {
    const len = chars.length;

    for (let i = len - 1; i >= key; i--) {
      if (i % 2 !== 0) {
        const a = i - key;
        const b = i;
        const tmp = chars[a]!;
        chars[a] = chars[b]!;
        chars[b] = tmp;
      }
    }
  }
}

export function unscrambleImageList(imageList: string, js: string): string {
  const chars = imageList.split("");
  const keyLocations = findKeyLocations(js);
  const unscrambleKey: number[] = [];

  for (const loc of keyLocations) {
    const digit = chars[loc];
    if (!digit || !/[0-9]/.test(digit)) return imageList;
    unscrambleKey.push(Number(digit));
  }

  keyLocations.forEach((loc, idx) => {
    const removeAt = loc - idx;
    if (removeAt >= 0 && removeAt < chars.length) {
      chars.splice(removeAt, 1);
    }
  });

  unscrambleChars(chars, unscrambleKey);
  return chars.join("");
}

export function findCols(input: string): number {
  const match = /var\s+widthnum\s*=\s*heightnum\s*=\s*(\d+)/.exec(input);
  return match ? Number(match[1]) : 0;
}

const REPLACE_POS_JS = `
function replacePos(strObj, pos, replacetext) {
  var str = strObj.substr(0, pos) + replacetext + strObj.substring(pos + 1, strObj.length);
  return str;
}
`;

const JS_FILTERS = [
  "jQuery",
  "document",
  "getContext",
  "toDataURL",
  "getImageData",
  "width",
  "height",
];

export function getDescramblingKey(deobfChapterJs: string, imageUrl: string): string {
  const splitA = deobfChapterJs.split("var renImg = function(img,width,height,id){");
  if (splitA.length < 2) throw new Error("renImg pattern not found");

  const splitB = splitA[1]!.split("key = key.split(");
  if (splitB.length < 2) throw new Error("key split pattern not found");

  const before = splitB[0]!;

  const imgkeys = before
    .split("\n")
    .filter((line) => JS_FILTERS.every((f) => !line.includes(f)))
    .join("\n")
    .replaceAll("img.src", "url");

  const scriptText = `
${REPLACE_POS_JS}
function getDescramblingKeyInner(url) {
  ${imgkeys}
  return key;
}
return getDescramblingKeyInner(${JSON.stringify(imageUrl)});
`;

  const functionConstructor = globalThis.Function;
  return functionConstructor(scriptText)() as string;
}

function arrayBufferToBase64(data: ArrayBuffer): string {
  const encoded = Application.base64Encode(data);
  return typeof encoded === "string" ? encoded : Application.arrayBufferToASCIIString(encoded);
}

function decodeDataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Invalid data URL");

  const payload = dataUrl.slice(comma + 1);
  const decoded = Application.base64Decode(payload);

  if (typeof decoded === "string") {
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return bytes.buffer;
  }

  return decoded;
}

async function loadImageFromBuffer(data: ArrayBuffer, mimeType: string): Promise<HTMLImageElement> {
  const b64 = arrayBufferToBase64(data);
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const img = new Image();

  // Settle once across all JSCore Image-polyfill behaviours (sync-complete,
  // async onload/onerror, or neither). The timer here is a settle-guard, NOT a
  // network/fetch timeout: if the polyfill never fires a callback, this rejects
  // so interceptResponse returns the raw bytes instead of leaving the reader
  // spinning forever.
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    let settled = false;
    const done = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => done(() => reject(new Error("image load timed out"))), 10000);
    img.onload = () => done(() => resolve(img));
    img.onerror = () => done(() => reject(new Error("Image load failed")));
    img.src = dataUrl;
    if (img.complete && img.naturalWidth > 0) {
      done(() => resolve(img));
    }
  });
}

export async function descrambleMangagoImage(
  data: ArrayBuffer,
  key: string,
  cols: number,
  mimeType: string,
): Promise<ArrayBuffer> {
  const src = await loadImageFromBuffer(data, mimeType);

  const width = src.naturalWidth || src.width;
  const height = src.naturalHeight || src.height;

  const unitWidth = Math.floor(width / cols);
  const unitHeight = Math.floor(height / cols);

  if (unitWidth <= 0 || unitHeight <= 0) {
    throw new Error(`Invalid tile size for ${width}x${height}, cols=${cols}`);
  }

  const keyArray = key.split("a").map((x) => {
    const n = Number(x || "0");
    return Number.isFinite(n) ? n : 0;
  });

  if (keyArray.length < cols * cols - 1) {
    throw new Error(`Invalid key array length ${keyArray.length}, expected ${cols * cols}`);
  }

  const canvas = new HTMLCanvasElement();
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context");

  ctx.drawImage(src, 0, 0, width, height);

  for (let idx = 0; idx < cols * cols; idx++) {
    const keyval = keyArray[idx] ?? 0;

    const destRow = Math.floor(keyval / cols);
    const dy = destRow * unitHeight;
    const dx = (keyval - destRow * cols) * unitWidth;

    const srcRow = Math.floor(idx / cols);
    const sy = srcRow * unitHeight;
    const sx = (idx - srcRow * cols) * unitWidth;

    ctx.drawImage(src, sx, sy, unitWidth, unitHeight, dx, dy, unitWidth, unitHeight);
  }

  return decodeDataUrlToArrayBuffer(canvas.toDataURL(mimeType));
}

// Decrypt + unscramble a single reader page's imgsrcs blob into raw image URLs.
function decodeImgsrcsBlob(
  imgsrcsRaw: string,
  deobfChapterJs: string,
  keyHex: string,
  ivHex: string,
  keepBlanks = false,
): Promise<string[]> {
  const encrypted = base64ToArrayBuffer(imgsrcsRaw);

  return aesCbcDecrypt(encrypted, decodeHex(keyHex), decodeHex(ivHex)).then((decryptedBuffer) => {
    // Use Paperback's provided converter rather than a global TextDecoder: the
    // on-device iOS runtime polyfills Application.* and Image/HTMLCanvasElement,
    // but does not guarantee the WHATWG TextDecoder global (no other source in
    // this repo relies on it). This blob is plain ASCII (comma-joined URLs).
    let decryptedText = Application.arrayBufferToUTF8String(decryptedBuffer);

    const nulChar = String.fromCharCode(0);
    while (decryptedText.endsWith(nulChar)) {
      decryptedText = decryptedText.slice(0, -1);
    }

    decryptedText = decryptedText.replace(/,+$/g, "");

    const imageList = unscrambleImageList(decryptedText, deobfChapterJs);

    const images = imageList.split(",").map((x) => x.trim());
    return keepBlanks ? images : images.filter(Boolean);
  });
}

// Turn a raw image URL into the final URL, appending the descramble fragment
// for scrambled (cspiclink) images so the interceptor can unscramble them.
function annotateImageUrl(rawUrl: string, deobfChapterJs: string, cols: number): string {
  const abs = absoluteUrl(rawUrl);

  if (!abs.includes("cspiclink")) {
    return abs;
  }

  if (!cols) {
    console.log("[Mangago] cspiclink image found but cols missing");
    return abs;
  }

  try {
    const desckey = getDescramblingKey(deobfChapterJs, abs);
    return `${abs}#desckey=${encodeURIComponent(desckey)}&cols=${encodeURIComponent(String(cols))}`;
  } catch (error) {
    console.log(
      `[Mangago] failed to get descrambling key: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return abs;
  }
}

function extractTotalPages(html: string): number {
  const candidates = [
    /total_pages\s*=\s*["']?(\d+)/.exec(html)?.[1],
    /class=["'][^"']*multi_pg_tip[^"']*["'][^>]*>\s*\(\s*\d+\s*\/\s*(\d+)\s*\)/i.exec(html)?.[1],
    /page\s+\d+\s+of\s+(\d+)/i.exec(html)?.[1],
  ];

  for (const candidate of candidates) {
    const value = candidate ? Number(candidate) : 0;
    if (Number.isFinite(value) && value > 0) return value;
  }

  return 0;
}

function extractCurrentReaderPage(html: string): number | undefined {
  const candidates = [
    /current_page\s*=\s*["']?(\d+)/.exec(html)?.[1],
    /class=["'][^"']*multi_pg_tip[^"']*["'][^>]*>\s*\(\s*(\d+)\s*\/\s*\d+\s*\)/i.exec(html)?.[1],
  ];

  for (const candidate of candidates) {
    const value = candidate ? Number(candidate) : 0;
    if (Number.isFinite(value) && value > 0) return value;
  }

  return undefined;
}

// The reader-page URL template, e.g. "/chapter/35134/2096487/{page}/".
function extractCurlTemplate(html: string): string | undefined {
  const match = /<input[^>]*id=["']curl["'][^>]*value=["']([^"']+)["']/i.exec(html);
  return match?.[1]?.trim();
}

// Some read-manga reader pages now ship an unusable curl value of "/" and put
// the actual current page URL in the pcurl JavaScript variable instead. Turn
// that concrete pg-N URL into the same {page} template the walker expects.
function extractPcurlTemplate(html: string): string | undefined {
  const match = /\bpcurl\s*=\s*["']([^"']*\/pg-)\d+(\/[^"']*)?["']/.exec(html);
  if (!match?.[1]) return undefined;

  return `${match[1]}{page}${match[2] ?? ""}`;
}

function usableCurlTemplate(template: string | undefined): string | undefined {
  if (!template || !template.includes("{page}")) return undefined;

  return template;
}

// The site's own multimode flag: `_multimode = "1"` for paginated readers
// (page 1 holds only a slice of the chapter), `""` for single-page readers
// (page 1 holds every image).
function extractMultimode(html: string): string {
  const match = /_multimode\s*=\s*["']([^"']*)["']/.exec(html);
  return match?.[1] ?? "";
}

// The reader's "next page" anchor href. This is the link the site itself uses
// to advance the reader, so following it is correct regardless of what the page
// parameter means (image index vs. reader-page index vs. pg-N slug). On the
// last page of a chapter it points at the next chapter, which we detect and use
// as the natural stop signal.
function extractNextPageHref(html: string): string | undefined {
  const anchors = [
    /<a\b(?=[^>]*class=["'][^"']*next_page[^"']*["'])[^>]*>/i.exec(html)?.[0],
    /<a\b(?=[^>]*id=["']pic_container["'])[^>]*>/i.exec(html)?.[0],
    /<a\b(?=[^>]*alt=["']next page["'])[^>]*>/i.exec(html)?.[0],
  ];

  for (const anchor of anchors) {
    const href = anchor ? /\bhref=["']([^"']+)["']/i.exec(anchor)?.[1]?.trim() : undefined;
    if (href) return href;
  }

  return undefined;
}

// Identify a chapter (independent of which page within it) from a reader URL or
// path, so a "next page" link can be told apart from a "next chapter" link:
//   /chapter/<mid>/<cid>/<page>/        -> c:<cid>
//   /read-manga/<slug>/.../chapter-<id>/pg-<n>/ -> rm:<id>
function readerChapterKey(u: string): string {
  let path = u;
  try {
    path = new URL(u).pathname;
  } catch {
    // keep the raw string
  }

  const numeric = /\/chapter\/\d+\/(\d+)(?:\/|$)/.exec(path);
  if (numeric) return `c:${numeric[1]}`;

  const readManga = /chapter-(\d+)/i.exec(path);
  if (readManga) return `rm:${readManga[1]}`;

  return path;
}

// Mangago's "not found" page returns HTTP 404 with a recognizable body. Detect
// it so the walker can treat the page as DEFINITIVELY absent and stop retrying
// it — a 404 is not a transient failure, so re-fetching it just hammers the site
// (the repeated requests the rate limiter is wrongly blamed for).
function isMangago404Page(html: string): boolean {
  return (
    /<title>\s*404\s*-\s*mangago\s*<\/title>/i.test(html) ||
    /the page you have requested is not available/i.test(html)
  );
}

function resolveUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return absoluteUrl(url);
  }
}

function extractChapterJsUrl(html: string): string | undefined {
  const match =
    html.match(/<script\b[^>]+src=["']([^"']*chapter\.js[^"']*)["'][^>]*>/i) ??
    html.match(/src=["']([^"']*chapter\.js[^"']*)["']/i);
  return match?.[1];
}

function extractImgsrcsFromHtml(html: string): string | undefined {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1] ?? "",
  );
  const imgsrcsScript = scripts.find((s) => s.includes("imgsrcs"));
  return imgsrcsScript ? extractImgsrcs(imgsrcsScript) : undefined;
}

// Validate a deobfuscated chapter.js before trusting it — especially one read
// back from persistent state, which could be truncated or stale. Require every
// marker the decode pipeline needs: the AES key/iv, the column count, and the
// renImg / "key = key.split(" markers getDescramblingKey parses. If any is
// missing, the caller refetches instead of silently breaking decode/descramble.
function isUsableDeobfChapterJs(js: unknown): js is string {
  return (
    typeof js === "string" &&
    js.length > 1000 &&
    !!findHexEncodedVariable(js, "key") &&
    !!findHexEncodedVariable(js, "iv") &&
    findCols(js) > 0 &&
    js.includes("var renImg = function(img,width,height,id){") &&
    js.includes("key = key.split(")
  );
}

async function getCachedDeobfChapterJs(chapterJsUrl: string): Promise<string> {
  const cached = chapterJsCache.get(chapterJsUrl);
  if (cached) return cached;

  // Persistent cache (survives app launches), keyed by the versioned script URL.
  // A version bump changes the key, so a stale script can't be re-served.
  const stateKey = `${CHAPTER_JS_STATE_PREFIX}${chapterJsUrl}`;
  try {
    const persisted = Application.getState(stateKey);
    if (isUsableDeobfChapterJs(persisted)) {
      chapterJsCache.set(chapterJsUrl, persisted);
      return persisted;
    }
  } catch {
    // State read is only an optimization; fall through to fetch.
  }

  const obfuscatedChapterJs = await fetchText(chapterJsUrl);
  const deobf = sojsonV4Decode(obfuscatedChapterJs);
  chapterJsCache.set(chapterJsUrl, deobf);

  // Only persist a value we've validated, so a bad decode is never frozen into
  // state and re-served on the next launch.
  if (isUsableDeobfChapterJs(deobf)) {
    try {
      Application.setState(deobf, stateKey);
    } catch {
      // Persisting is an optimization; ignore storage failures.
    }
  }

  return deobf;
}

// Match a single curl-template path segment (which may contain "{page}")
// against a concrete URL segment.
function templateSegmentMatches(templateSegment: string, urlSegment: string): boolean {
  const escaped = templateSegment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = `^${escaped.replace(/\\\{[^}]+\\\}/g, "[^/]+")}$`;
  return new RegExp(pattern).test(urlSegment);
}

// Merge the curl template into a concrete URL path. Numeric readers serve a
// full-path template ("/chapter/ID/CID/{page}/") so this is an identity; some
// read-manga regions serve a template relative to the chapter slug
// ("/uu/nml_chapter-41/pg-{page}/"), so we splice it onto the real path prefix
// from the next_page href instead of resolving it against the domain root
// (which would 404).
function mergeUrlPathWithTemplate(urlPath: string, template: string): string {
  const urlSegments = urlPath
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  const templateSegments = template
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);

  let bestStart = -1;
  let bestLength = 0;

  for (let start = 0; start < urlSegments.length; start++) {
    let length = 0;
    while (
      length < templateSegments.length &&
      start + length < urlSegments.length &&
      templateSegmentMatches(templateSegments[length]!, urlSegments[start + length]!)
    ) {
      length++;
    }
    if (length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
  }

  const tail = template.endsWith("/") ? "/" : "";
  if (bestStart >= 0 && bestLength > 0) {
    const prefix = urlSegments.slice(0, bestStart);
    return `/${[...prefix, ...templateSegments].join("/")}${tail}`;
  }
  return `/${[...urlSegments, ...templateSegments].join("/")}${tail}`;
}

// True when the curl template's {page} parameter is a 1-based IMAGE index
// (numeric reader, "/chapter/<mid>/<cid>/{page}/"). read-manga "pg-{page}"
// templates index reader pages instead, so the image-count stride guess does
// not apply there.
function isImageIndexTemplate(template: string): boolean {
  return /\/chapter\/\d+\/\d+\/\{page\}\/?$/.test(template);
}

// Build the URL for reader page N. Prefer the site's next_page href as the
// concrete example path and merge the template into it; fall back to resolving
// the template against the loaded URL. Only used as a fallback when a sub-page
// omits its own next_page link.
function buildReaderPageUrl(
  template: string,
  baseUrl: string,
  page: number,
  nextPageHref?: string,
): string {
  const concreteBase = nextPageHref ? resolveUrl(nextPageHref, baseUrl) : baseUrl;
  try {
    const base = new URL(concreteBase);
    base.pathname = mergeUrlPathWithTemplate(base.pathname, template).replace(
      "{page}",
      String(page),
    );
    base.search = "";
    base.hash = "";
    return base.toString();
  } catch {
    return resolveUrl(template.replace("{page}", String(page)), baseUrl);
  }
}

// Fetch one reader page by URL, trying mirrors in order (preferred host first).
// Returns the page HTML (which contains both the imgsrcs blob and the next_page
// link) plus the origin that served it, so the caller can stick with a working
// mirror and stop re-probing dead ones (mangago.me 404s every numeric reader
// page).
async function fetchReaderPage(
  pageUrl: string,
  preferredOrigin: string | undefined,
): Promise<{ html: string; url: string; origin: string } | undefined> {
  // Force the page onto a host that serves this reader format BEFORE anything
  // else (numeric /chapter/ -> mirror, read-manga -> www.mangago.me). A relative
  // next-page link, an absolute link on the wrong host, or a quirky response URL
  // could otherwise leave a numeric page pointed at www.mangago.me, which 404s.
  pageUrl = canonicalReaderUrl(pageUrl);

  // Reuse a recently-fetched copy of this reader page if we have one (e.g. when
  // re-walking an incomplete chapter), so we don't re-hit the network or the
  // rate limiter for pages that already loaded.
  const cachedHtml = getCachedReaderHtml(pageUrl);
  if (cachedHtml) {
    return { html: cachedHtml, url: pageUrl, origin: preferredOrigin ?? originOf(pageUrl) ?? "" };
  }

  const numericPage = isNumericReaderPath(pathnameKey(pageUrl));

  // www.mangago.me 404s EVERY numeric reader page. When a chapter's page 1 is the
  // read-manga reader (host www.mangago.me) but its pagination template points at
  // the numeric reader, preferredOrigin/originOf would be www.mangago.me — and
  // withMirror() below would then slam each numeric sub-page back onto
  // www.mangago.me and 404. So for numeric paths we drop any main-domain origin
  // and only ever fetch from the mirrors that actually serve them.
  const isMainDomainOrigin = (o: string): boolean => {
    try {
      const host = new URL(o).hostname.toLowerCase();
      return host === "mangago.me" || host === "www.mangago.me";
    } catch {
      return false;
    }
  };

  const origins: string[] = [];
  const pushOrigin = (o: string | undefined): void => {
    if (!o) return;
    if (numericPage && isMainDomainOrigin(o)) return;
    if (!origins.includes(o)) origins.push(o);
  };
  pushOrigin(preferredOrigin);
  pushOrigin(originOf(pageUrl));
  // Numeric reader pages 404 on www.mangago.me, so fall back across the mirror
  // hosts that actually serve them — NOT the main domain. read-manga pages are
  // served by www.mangago.me, so fall back there for those.
  if (numericPage) {
    pushOrigin(READER_MIRROR);
    pushOrigin(READER_MIRROR_FALLBACK);
  } else {
    pushOrigin(DOMAIN);
  }

  // Retry across a few rounds with a short backoff between them. The backoff is
  // a wait BETWEEN retries, NOT a fetch timeout: a reader page can transiently
  // fail (rate-limit, -999 cancel, momentary network), and the walk treats one
  // failed page as the end of the chapter. Without the pause all rounds fire
  // within a few ms — before the blip clears — and the chapter truncates to
  // page 1. Mirror rotation alone does not help when every mirror is briefly
  // unhappy at the same instant.
  // If every mirror/round fails specifically with a Cloudflare challenge, we
  // surface it (below) so Paperback shows the bypass webview instead of letting
  // the walk silently truncate the chapter to page 1.
  let cloudflareError: CloudflareError | undefined;

  const MAX_ROUNDS = 3;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    // Did any origin fail in a way worth retrying (network blip, rate-limit, a
    // non-404 empty page)? A definitive 404 is NOT retryable, so if every origin
    // 404s we stop after this round instead of re-hammering the same dead page.
    let sawRetryableFailure = false;

    for (const origin of origins) {
      const url = withMirror(pageUrl, origin);
      try {
        await paceReaderFetch();
        const html = await fetchText(url, {
          "user-agent": DESKTOP_USER_AGENT,
          cookie: "_m_superu=1",
        });
        if (extractImgsrcsFromHtml(html)) {
          console.log(`[Mangago] reader fetch OK ${url}`);
          cacheReaderHtml(pageUrl, html);
          return { html, url, origin };
        }
        if (isMangago404Page(html)) {
          console.log(`[Mangago] ${url} -> 404 page (not retrying)`);
        } else {
          sawRetryableFailure = true;
          console.log(`[Mangago] ${url} returned HTML but no imgsrcs`);
        }
      } catch (error) {
        if (error instanceof CloudflareError) cloudflareError = error;
        sawRetryableFailure = true;
        console.log(
          `[Mangago] reader fetch failed ${url}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        // Otherwise try the next mirror.
      }
    }

    // Every origin definitively 404'd this page — further rounds would just
    // re-request a page the site will never serve. Give up now.
    if (!sawRetryableFailure) break;
    if (round < MAX_ROUNDS) {
      await new Promise((resolve) => setTimeout(resolve, 400 * round));
    }
  }

  // A real Cloudflare wall on the sub-pages must reach the user as a bypass
  // prompt, not a silently short chapter.
  if (cloudflareError) throw cloudflareError;

  return undefined;
}

async function decodeReaderPageImages(
  pageUrl: string,
  preferredOrigin: string | undefined,
  deobfChapterJs: string,
  keyHex: string,
  ivHex: string,
  keepBlanks = false,
): Promise<{ images: string[]; html: string; url: string; origin: string } | undefined> {
  const result = await fetchReaderPage(pageUrl, preferredOrigin);
  if (!result) return undefined;

  const imgsrcs = extractImgsrcsFromHtml(result.html);
  if (!imgsrcs) return undefined;

  const images = await decodeImgsrcsBlob(imgsrcs, deobfChapterJs, keyHex, ivHex, keepBlanks);
  if (!images.some(Boolean)) return undefined;

  return { ...result, images };
}

export async function getMangagoPageUrls(chapterUrl: string): Promise<string[]> {
  const cachedPages = mangagoPageUrlsCache.get(chapterUrl);
  if (cachedPages && cachedPages.length > 0) {
    return cachedPages;
  }

  // Fetch the chapter page from the host that serves this reader format:
  // read-manga from www.mangago.me (returns the COMPLETE image list in one shot
  // with the desktop UA), numeric from the mirror hosts (www.mangago.me 404s
  // them). Do NOT force www.mangago.me — that was the cause of the numeric-reader
  // 404s. A stale library URL on any host is re-routed by canonicalReaderUrl.
  let html = "";
  let loadedUrl = chapterUrl;
  let cloudflareError: CloudflareError | undefined;
  const tried = new Set<string>();
  const canonical = canonicalReaderUrl(chapterUrl);
  // For a numeric reader, try BOTH mirrors regardless of which one `canonical`
  // already points at. canonicalReaderUrl now preserves an existing mirror host
  // (so a chapter stays on the mirror that served it), but that must not cost us
  // the fallback: if the preferred mirror is momentarily down, the other mirror
  // still serves the page. The `tried` set below dedupes, so listing both is
  // free when canonical already equals one of them.
  const candidates = isNumericReaderPath(pathnameKey(canonical))
    ? [
        canonical,
        withMirror(canonical, READER_MIRROR),
        withMirror(canonical, READER_MIRROR_FALLBACK),
        chapterUrl,
      ]
    : [canonical, chapterUrl];

  for (const candidate of candidates) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);

    const cached = getCachedReaderHtml(candidate);
    if (cached && cached.includes("imgsrcs")) {
      html = cached;
      loadedUrl = canonicalReaderUrl(candidate);
      break;
    }

    try {
      // No paceReaderFetch() here: this is the single initial chapter-page fetch
      // (at most one request per mirror), not the reader sub-page burst. The
      // 350 ms pace would just add latency to every chapter open; the
      // BasicRateLimiter (5/s) still guards against bursts. The pace is kept
      // where it matters — inside fetchReaderPage (walk + lazy sub-page
      // resolution), which is what the burst-truncation fix relies on.
      const { text: attempt, finalUrl } = await fetchTextWithUrl(candidate, {
        "user-agent": DESKTOP_USER_AGENT,
        cookie: "_m_superu=1",
      });
      if (attempt.includes("imgsrcs")) {
        cacheReaderHtml(candidate, attempt);
        html = attempt;
        // Use the FINAL URL (after any mangago.me numeric -> read-manga
        // redirect) so the page walk keys off the reader page we actually
        // landed on; otherwise same-chapter next_page links won't match the
        // stale request URL and the walk stops after the first window. Route it
        // to the canonical host so the walk's preferredOrigin is the mirror that
        // actually serves this format (a quirky response URL can't send the walk
        // back to www.mangago.me, which 404s numeric pages).
        loadedUrl = canonicalReaderUrl(finalUrl);
        break;
      }
    } catch (error) {
      if (error instanceof CloudflareError) cloudflareError = error;
      // Otherwise try the next mirror.
    }
  }

  // Prefer surfacing a Cloudflare challenge (triggers the bypass webview) over a
  // generic "no usable page" error when every mirror was walled.
  if (!html && cloudflareError) throw cloudflareError;
  if (!html) throw new Error("[Mangago] no mirror returned a usable chapter page");

  const imgsrcsRaw = extractImgsrcsFromHtml(html);
  if (!imgsrcsRaw) throw new Error("Could not extract imgsrcs");

  const chapterJsSrc = extractChapterJsUrl(html);
  if (!chapterJsSrc) throw new Error("Could not find chapter.js URL");

  const chapterJsUrl = resolveUrl(chapterJsSrc, loadedUrl);
  const deobfChapterJs = await getCachedDeobfChapterJs(chapterJsUrl);

  const keyHex = findHexEncodedVariable(deobfChapterJs, "key");
  const ivHex = findHexEncodedVariable(deobfChapterJs, "iv");
  if (!keyHex) throw new Error("Could not find AES key");
  if (!ivHex) throw new Error("Could not find AES IV");

  const cols = findCols(deobfChapterJs);

  // Decode page 1's imgsrcs POSITIONALLY (keep blanks). Mangago commonly ships
  // the full positional image list on page 1 (with blank entries for positions
  // that belong to other windows), so the presence of blanks is one windowed
  // signal — exactly what keiyoushi and Aidoku key off of.
  const firstPositional = await decodeImgsrcsBlob(imgsrcsRaw, deobfChapterJs, keyHex, ivHex, true);
  const firstImages = firstPositional.filter((url) => url.trim() !== "");

  // The site's own windowing flag is the SECOND, authoritative signal. Some
  // numeric/.zone readers emit exactly one window's worth of real URLs with NO
  // blank padding while total_pages is far larger, so "no blanks" alone would
  // wrongly treat that single window as the whole chapter and return e.g. 5 of
  // 83 images. `_multimode = "1"` means page 1 is only a slice regardless of
  // blanks. (With the _m_superu=1 cookie + desktop UA we now send everywhere,
  // most readers report `_multimode = ""` and serve the full list on page 1.)
  const multimodeFlag = extractMultimode(html);

  // Eager fast path: page 1 already holds the whole chapter — return the real
  // image URLs directly, no walk, no placeholders. This is the common case and
  // the entire strategy Aidoku uses, plus keiyoushi's fast path. Gate it on BOTH
  // signals agreeing: the site does not flag the reader as windowed AND there
  // are no blank slots. Anything else falls through to the eager walk below.
  if (
    multimodeFlag !== "1" &&
    firstPositional.length > 0 &&
    firstImages.length === firstPositional.length
  ) {
    const pages = firstImages.map((url) => annotateImageUrl(url, deobfChapterJs, cols));
    console.log(`[Mangago] page 1 complete -> ${pages.length} images (eager)`);
    if (pages.length > 0) mangagoPageUrlsCache.set(chapterUrl, pages);
    return pages;
  }

  const totalPages = extractTotalPages(html);
  const curlTemplate = usableCurlTemplate(extractCurlTemplate(html)) ?? extractPcurlTemplate(html);
  const nextPageHref = extractNextPageHref(html);
  const firstPageChapterKey = readerChapterKey(loadedUrl);
  const nextPageSameChapter = nextPageHref
    ? readerChapterKey(resolveUrl(nextPageHref, loadedUrl)) === firstPageChapterKey
    : false;
  const imageIndexTemplate = !!curlTemplate && isImageIndexTemplate(curlTemplate);
  const totalImagePages =
    !curlTemplate || imageIndexTemplate
      ? multimodeFlag === "1" && totalPages > 0 && firstImages.length >= totalPages
        ? 0
        : totalPages
      : 0;
  const totalReaderPages =
    curlTemplate && !imageIndexTemplate && totalPages > 0 && firstImages.length < totalPages
      ? totalPages
      : 0;

  console.log(
    `[Mangago] chapter ${chapterUrl} | firstImages=${firstImages.length} total_pages=${totalPages} multimode=${
      multimodeFlag || "(none)"
    } curl=${curlTemplate ?? "none"} next=${nextPageHref ?? "none"} nextSameChapter=${nextPageSameChapter}`,
  );

  // A multimode reader holds only a slice of the chapter on page 1; the rest
  // live on the following reader pages reachable via the next_page link.
  //
  // Mangago's `total_pages` value is not stable across reader variants. Numeric
  // readers report a total IMAGE count, while some manhwa/read-manga readers
  // report a total READER-WINDOW count. If page 1 already contains at least
  // that many images, treating the value as an image total would incorrectly
  // stop after the first 5-image window. In that case, leave the image total
  // open-ended and walk links until the site points at the next chapter.
  const isMultimode =
    (!!curlTemplate || !!nextPageHref) &&
    (multimodeFlag === "1" ||
      nextPageSameChapter ||
      (totalPages > 0 && firstImages.length < totalPages));

  // Windowed multimode (page 1 had blank slots) is resolved EAGERLY by walking
  // every reader window below and collecting the real image URLs — no lazy
  // placeholders. Paperback fetches the returned image URLs directly, so a
  // marker URL must never end up in the page list.
  let rawImages: string[];
  let complete = true;

  if (!isMultimode) {
    console.log(`[Mangago] single-page path -> ${firstImages.length} images`);
    rawImages = firstImages;
  } else {
    console.log(
      `[Mangago] multimode path -> walking reader pages (page 1 already loaded, total images=${totalPages})`,
    );

    const pageSlots = new Map<number, string>();
    const seen = new Set<string>();
    const addImagesAt = (startPage: number, imgs: string[], positional = false): number => {
      let added = 0;
      imgs.forEach((img, index) => {
        const clean = img.trim();
        if (!clean || seen.has(clean)) return;

        const page = positional ? index + 1 : startPage + index;
        if (page < 1 || (totalImagePages > 0 && page > totalImagePages)) return;

        seen.add(clean);
        pageSlots.set(page, clean);
        added++;
      });
      return added;
    };
    const collectedCount = (): number => pageSlots.size;
    const nextMissingPage = (): number => {
      if (totalImagePages > 0) {
        for (let page = 1; page <= totalImagePages; page++) {
          if (!pageSlots.has(page)) return page;
        }
      }
      return collectedCount() + 1;
    };

    addImagesAt(extractCurrentReaderPage(html) ?? 1, firstImages);

    // Follow the last successful reader page's own next_page link (exact, and it
    // handles variable window sizes and stops naturally when the link crosses
    // into the next chapter). When a page FAILS, fall back — on the numeric
    // image-index reader only — to the curl template at the next expected image
    // index and SKIP the failed window instead of dropping the rest of the
    // chapter (gap-tolerant, like the MangaFox extension). read-manga "pg-N"
    // readers use the template's reader-page number instead, because each
    // pg-N window can contain several images (commonly 5).
    const chapterKey = firstPageChapterKey;
    // Pages already loaded/attempted, keyed mirror-independently by path, so the
    // walk only ever moves forward (a backward/duplicate link can't stall it).
    const visitedPaths = new Set<string>([pathnameKey(loadedUrl)]);

    // Window size = how many images page 1 carried; used to step past a failed
    // page on the numeric reader.
    const stride = Math.max(1, firstImages.length);
    const imageIndexReader = imageIndexTemplate;

    let preferredOrigin = originOf(loadedUrl);
    let currentHtml = html; // HTML of the last reader page fetched successfully
    let currentUrl = loadedUrl;
    let expectedNext = imageIndexReader
      ? nextMissingPage()
      : (extractCurrentReaderPage(html) ?? readMangaPagePosition(loadedUrl) ?? 1) + 1;
    let consecutiveFailures = 0;
    let safety = Math.max(totalImagePages, totalReaderPages, firstImages.length, 50) + 25;
    let exhaustedSafety = true;

    while (safety-- > 0) {
      if (totalImagePages > 0 && collectedCount() >= totalImagePages) {
        exhaustedSafety = false;
        break; // collected them all
      }
      if (!imageIndexReader && totalReaderPages > 0 && expectedNext > totalReaderPages) {
        exhaustedSafety = false;
        break; // visited every known reader-page window
      }

      let nextUrl: string | undefined;
      const nextHref = currentHtml ? extractNextPageHref(currentHtml) : undefined;
      if (nextHref) {
        const resolved = resolveUrl(nextHref, currentUrl);
        if (readerChapterKey(resolved) === chapterKey) {
          nextUrl = resolved;
        }
      }

      if (
        !nextUrl &&
        curlTemplate &&
        (imageIndexReader
          ? totalImagePages === 0 || expectedNext <= totalImagePages
          : totalReaderPages === 0 || expectedNext <= totalReaderPages)
      ) {
        nextUrl = buildReaderPageUrl(curlTemplate, currentUrl || loadedUrl, expectedNext);
      }

      if (!nextUrl) {
        exhaustedSafety = false;
        break; // next chapter or no usable next link/template -> done
      }

      // Forward-only guard. If we've already loaded/tried this page, skip past it
      // on the numeric reader (a duplicate/backward link can't stall us);
      // otherwise stop.
      if (visitedPaths.has(pathnameKey(nextUrl))) {
        if (imageIndexReader) {
          expectedNext = (readerPagePosition(nextUrl) ?? expectedNext) + stride;
          currentHtml = "";
          complete = false;
          continue;
        }
        if (curlTemplate && (totalReaderPages === 0 || expectedNext <= totalReaderPages)) {
          currentHtml = "";
          expectedNext++;
          complete = false;
          continue;
        }
        console.log(`[Mangago] next reader page ${nextUrl} already visited -> stop`);
        exhaustedSafety = false;
        break;
      }
      visitedPaths.add(pathnameKey(nextUrl));

      const result = await decodeReaderPageImages(
        nextUrl,
        preferredOrigin,
        deobfChapterJs,
        keyHex,
        ivHex,
      );
      let progressed = false;
      if (
        result &&
        addImagesAt(
          imageIndexReader
            ? (extractCurrentReaderPage(result.html) ??
                readerPagePosition(result.url) ??
                expectedNext)
            : collectedCount() + 1,
          result.images,
        ) > 0
      ) {
        progressed = true;
        preferredOrigin = result.origin;
        currentHtml = result.html;
        currentUrl = result.url;
        expectedNext = imageIndexReader
          ? nextMissingPage()
          : (extractCurrentReaderPage(result.html) ??
              readMangaPagePosition(result.url) ??
              expectedNext) + 1;
      }

      if (progressed) {
        consecutiveFailures = 0;
        continue;
      }

      // This page failed (unavailable / no imgsrcs / decoded nothing / only
      // duplicates). On the numeric image-index reader, skip the failed window
      // and keep collecting the rest (gap-tolerant), bailing after a few
      // failures in a row so a dead reader doesn't hammer every page. read-manga
      // pg-N readers skip to the next reader window instead of confusing reader
      // page numbers with image indexes.
      complete = false;
      if (imageIndexReader) {
        const skipTo = (readerPagePosition(nextUrl) ?? expectedNext) + stride;
        console.log(`[Mangago] reader page ${nextUrl} failed -> skip to image ${skipTo}`);
        expectedNext = skipTo;
        currentHtml = "";
        if (++consecutiveFailures >= 3) {
          console.log(`[Mangago] 3 reader pages failed in a row -> stop`);
          exhaustedSafety = false;
          break;
        }
      } else if (curlTemplate && (totalReaderPages === 0 || expectedNext < totalReaderPages)) {
        const skipTo = (readMangaPagePosition(nextUrl) ?? expectedNext) + 1;
        console.log(`[Mangago] reader page ${nextUrl} failed -> skip to reader page ${skipTo}`);
        expectedNext = skipTo;
        currentHtml = "";
        if (++consecutiveFailures >= 3) {
          console.log(`[Mangago] 3 reader pages failed in a row -> stop`);
          exhaustedSafety = false;
          break;
        }
      } else {
        console.log(`[Mangago] reader page ${nextUrl} failed and not skippable -> stop`);
        exhaustedSafety = false;
        break;
      }
    }
    if (exhaustedSafety) complete = false;

    if (curlTemplate && totalImagePages > 0 && collectedCount() < totalImagePages) {
      const allowWindowFallback = imageIndexReader && collectedCount() === firstImages.length;
      console.log(
        `[Mangago] next_page walk only collected ${collectedCount()}/${totalPages}; trying direct curl crawl`,
      );

      // Retry missing slots by reader window. Numeric image-index URLs address a
      // whole reader window, not an individual image page; a transient failure
      // on /6/ can leave pages 6-10 empty, and retrying /7/, /8/, /9/, etc.
      // just hammers non-existent windows. Non-image-index readers still use
      // the exact missing page because their URLs are page-specific.
      const directTriedSlots = new Set<number>();
      const fallbackStartFor = (missing: number): number =>
        imageIndexReader ? Math.floor((missing - 1) / stride) * stride + 1 : missing;
      const markDirectTried = (start: number): void => {
        const windowSize = imageIndexReader ? stride : 1;
        for (let page = start; page < start + windowSize && page <= totalImagePages; page++) {
          directTriedSlots.add(page);
        }
      };
      const nextUntriedMissingPage = (): number | undefined => {
        for (let page = 1; page <= totalImagePages; page++) {
          if (!pageSlots.has(page) && !directTriedSlots.has(page)) return page;
        }
      };

      for (
        let missing = nextUntriedMissingPage();
        missing !== undefined && collectedCount() < totalImagePages;
        missing = nextUntriedMissingPage()
      ) {
        const page = fallbackStartFor(missing);
        markDirectTried(page);
        const fallbackUrl = buildReaderPageUrl(curlTemplate, loadedUrl, page, nextPageHref);

        const result = await decodeReaderPageImages(
          fallbackUrl,
          preferredOrigin,
          deobfChapterJs,
          keyHex,
          ivHex,
          true,
        );
        if (!result) {
          // A failed window here may be a transient miss (rate-limit, momentary
          // network) rather than a dead page — and later windows can still be
          // valid — so keep probing the remaining missing slots. The per-page
          // fetchReaderPage already bails fast on a definitive 404, so a truly
          // dead reader still does at most one request per window instead of a
          // retry storm.
          console.log(`[Mangago] direct curl window ${page} failed: ${fallbackUrl}`);
          continue;
        }

        preferredOrigin = result.origin;
        visitedPaths.add(pathnameKey(result.url));
        const currentPage =
          extractCurrentReaderPage(result.html) ?? readerPagePosition(result.url) ?? page;
        if (result.images.length >= totalImagePages) {
          addImagesAt(1, result.images, true);
        } else if (allowWindowFallback || currentPage === page) {
          addImagesAt(currentPage, result.images);
        }

        console.log(
          `[Mangago] direct curl window ${page} -> current=${currentPage}, images=${
            result.images.filter(Boolean).length
          }, collected=${collectedCount()}/${totalImagePages}`,
        );
      }
    }

    if (totalImagePages > 0) complete = collectedCount() >= totalImagePages;

    console.log(
      `[Mangago] multimode collected ${collectedCount()}/${
        totalImagePages || "unknown"
      } images (complete=${complete})`,
    );
    rawImages =
      totalImagePages > 0
        ? Array.from(
            { length: totalImagePages },
            (_, index) => pageSlots.get(index + 1) ?? "",
          ).filter(Boolean)
        : [...pageSlots.entries()].sort(([a], [b]) => a - b).map(([, url]) => url);
  }

  if (isMultimode && totalImagePages > 0 && rawImages.length < totalImagePages) {
    // Returning the successfully decoded URLs is better than throwing here:
    // Paperback shows a blank loading spinner when getChapterDetails rejects,
    // while a partial list still opens the reader and allows the user to read
    // every window Mangago served. Partial results are deliberately not cached
    // below, so reopening the chapter retries the missing windows.
    console.log(
      `[Mangago] returning partial multimode chapter: collected ${rawImages.length}/${totalImagePages} images`,
    );
  }

  const pages = rawImages.map((url) => annotateImageUrl(url, deobfChapterJs, cols));
  console.log(`[Mangago] returning ${pages.length} final page URLs for ${chapterUrl}`);

  // Only cache a result we believe is complete, so a partial/rate-limited run
  // is never frozen in the cache. Single-page is always complete; multimode is
  // complete only if every expected page slot was filled, including by fallback.
  if (pages.length > 0 && complete) {
    mangagoPageUrlsCache.set(chapterUrl, pages);
  }

  return pages;
}
