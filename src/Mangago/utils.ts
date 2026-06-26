import { DESKTOP_USER_AGENT } from "./models";
import { fetchText } from "./network";

const MANGAGO_DOMAIN = "https://www.mangago.me";
const MANGAGO_DOMAIN_HOST = "mangago.me";
const MANGAGO_READER_MIRRORS = [
  "https://www.mangago.me",
  "https://www.mangago.zone",
  "https://www.youhim.me",
];

// Image-load timeout guards a per-image fetch inside the descrambler.
const MANGAGO_IMAGE_LOAD_TIMEOUT_MS = 10000;
// Safety-net timeout on the chapter HTML + chapter.js requests. Without this
// a hung TCP socket can leave the reader spinning forever — Paperback does
// not always surface a request timeout to the extension fast enough on
// mobile networks. 15s is well above any normal page response and matches
// roughly what Paperback uses internally.
const MANGAGO_CHAPTER_FETCH_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const mangagoPageUrlsCache = new Map<string, string[]>();
const chapterJsCache = new Map<string, string>();
const descramblingKeyFunctionCache = new Map<string, (url: string) => string>();

type MangagoChapterHtml = {
  html: string;
  loadedUrl: string;
  preferredMirror?: string;
};

const MANGAGO_MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

type MinimalSelection = {
  toArray?: () => unknown[];
  get?: () => unknown[];
  length?: number;
};

type MinimalCheerioSelector = (selector: string) => MinimalSelection;

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);

  return out.buffer;
}

function stripFragment(url: string): string {
  const hashIndex = url.indexOf("#");

  return hashIndex >= 0 ? url.slice(0, hashIndex) : url;
}

function stripQueryAndFragment(url: string): string {
  const withoutFragment = stripFragment(url);
  const queryIndex = withoutFragment.indexOf("?");

  return queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment;
}

function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return undefined;
  }
}

function withMirror(url: string, mirror: string): string {
  try {
    const parsed = new URL(url, MANGAGO_DOMAIN);
    const mirrorUrl = new URL(mirror);
    parsed.protocol = mirrorUrl.protocol;
    parsed.host = mirrorUrl.host;

    return parsed.toString();
  } catch {
    const path = url.startsWith("/") ? url : `/${url}`;
    return `${mirror}${path}`;
  }
}

export function absoluteUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${MANGAGO_DOMAIN}${url}`;

  return `${MANGAGO_DOMAIN}/${url}`;
}

function absoluteUrlFromBase(url: string, baseUrl: string): string {
  if (!url) return "";
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;

  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return absoluteUrl(url);
  }
}

export function normalizeMangagoChapterUrl(url: string): string {
  let normalized = absoluteUrl(url);

  normalized = stripQueryAndFragment(normalized);

  if (!normalized.endsWith("/")) normalized += "/";

  return normalized;
}

function extractPathnameFromUrl(url: string): string {
  const cleaned = stripQueryAndFragment(url);

  if (cleaned.startsWith("//")) {
    const slashIndex = cleaned.indexOf("/", 2);
    return slashIndex >= 0 ? cleaned.slice(slashIndex) : "/";
  }

  const protoMatch = /^https?:\/\/[^/]+(\/.*)?$/.exec(cleaned);
  if (protoMatch) {
    return protoMatch[1] || "/";
  }

  return cleaned;
}

export function extractMangaId(href: string): string {
  if (!href) return "";

  try {
    const url = href.startsWith("http") ? new URL(href) : new URL(href, MANGAGO_DOMAIN);

    return url.pathname;
  } catch {
    return extractPathnameFromUrl(href);
  }
}

export function parseMangagoDate(dateText: string): Date | undefined {
  const trimmed = dateText.trim();
  if (!trimmed) return undefined;

  const match = /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/.exec(trimmed);
  if (!match) return undefined;

  const month = MANGAGO_MONTHS[match[1]!.toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);

  if (month === undefined || !Number.isFinite(day) || !Number.isFinite(year)) {
    return undefined;
  }

  const parsed = new Date(year, month, day);

  if (parsed.getFullYear() !== year || parsed.getMonth() !== month || parsed.getDate() !== day) {
    return undefined;
  }

  return parsed;
}

export function getMangagoChapterRows(select: MinimalCheerioSelector): unknown[] {
  const primary = select("table#chapter_table > tbody > tr");
  const primaryRows =
    typeof primary.toArray === "function"
      ? primary.toArray()
      : typeof primary.get === "function"
        ? primary.get()
        : [];

  if (primaryRows.length > 0) {
    return primaryRows;
  }

  const fallback = select("table.uk-table > tbody > tr");

  return typeof fallback.toArray === "function"
    ? fallback.toArray()
    : typeof fallback.get === "function"
      ? fallback.get()
      : [];
}

function isWhitespaceOrEquals(char: string): boolean {
  return char === " " || char === "\n" || char === "\r" || char === "\t" || char === "=";
}

function isDigitChar(char: string): boolean {
  return char >= "0" && char <= "9";
}

function isAsciiLetter(char: string): boolean {
  if (!char) return false;

  const code = char.charCodeAt(0);

  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

export function extractImgsrcs(input: string): string | undefined {
  const assignmentMatch =
    /(?:var\s+|let\s+|const\s+)?imgsrcs\s*=\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/.exec(
      input,
    );

  if (assignmentMatch?.[1] || assignmentMatch?.[2]) {
    return (assignmentMatch[1] ?? assignmentMatch[2])!.replace(/\\(["'\\])/g, "$1");
  }

  const marker = "imgsrcs";
  let searchFrom = 0;

  while (true) {
    const markerIndex = input.indexOf(marker, searchFrom);

    if (markerIndex < 0) return undefined;

    let index = markerIndex + marker.length;

    while (index < input.length && isWhitespaceOrEquals(input.charAt(index))) {
      index++;
    }

    const quote = input.charAt(index);

    if (quote !== '"' && quote !== "'") {
      searchFrom = markerIndex + marker.length;
      continue;
    }

    index++;

    const start = index;

    while (index < input.length) {
      if (input.charAt(index) === quote) {
        return input.slice(start, index);
      }

      index++;
    }

    return undefined;
  }
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

  return parts.map((part) => String.fromCharCode(Number(part))).join("");
}

function isIdentifierChar(char: string): boolean {
  return isAsciiLetter(char) || isDigitChar(char) || char === "_" || char === "$";
}

function skipWhitespace(input: string, index: number): number {
  while (index < input.length) {
    const char = input.charAt(index);

    if (char === " " || char === "\n" || char === "\r" || char === "\t") {
      index++;
      continue;
    }

    break;
  }

  return index;
}

export function findHexEncodedVariable(input: string, variable: string): string | undefined {
  let searchFrom = 0;
  const parseMarker = "CryptoJS.enc.Hex.parse(";

  while (true) {
    const variableIndex = input.indexOf(variable, searchFrom);
    if (variableIndex < 0) return undefined;

    const beforeChar = variableIndex > 0 ? input.charAt(variableIndex - 1) : "";
    const afterChar = input.charAt(variableIndex + variable.length);

    if (
      (beforeChar && isIdentifierChar(beforeChar)) ||
      (afterChar && isIdentifierChar(afterChar))
    ) {
      searchFrom = variableIndex + variable.length;
      continue;
    }

    let wordEnd = variableIndex;
    let wordStart = variableIndex - 1;

    while (wordStart >= 0) {
      const char = input.charAt(wordStart);

      if (char === " " || char === "\n" || char === "\r" || char === "\t") {
        wordStart--;
        continue;
      }

      break;
    }

    wordEnd = wordStart + 1;

    while (wordStart >= 0 && isAsciiLetter(input.charAt(wordStart))) {
      wordStart--;
    }

    const declarationWord = input.slice(wordStart + 1, wordEnd);

    if (declarationWord !== "var" && declarationWord !== "let" && declarationWord !== "const") {
      searchFrom = variableIndex + variable.length;
      continue;
    }

    let index = variableIndex + variable.length;
    index = skipWhitespace(input, index);

    if (input.charAt(index) !== "=") {
      searchFrom = variableIndex + variable.length;
      continue;
    }

    index++;
    index = skipWhitespace(input, index);

    if (!input.startsWith(parseMarker, index)) {
      searchFrom = variableIndex + variable.length;
      continue;
    }

    index += parseMarker.length;
    index = skipWhitespace(input, index);

    const quote = input.charAt(index);
    if (quote !== '"' && quote !== "'") {
      searchFrom = variableIndex + variable.length;
      continue;
    }

    index++;
    const start = index;

    while (index < input.length) {
      if (input.charAt(index) === quote) {
        const hex = input.slice(start, index);

        if (/^[0-9a-fA-F]+$/.test(hex)) {
          return hex;
        }

        return undefined;
      }

      index++;
    }

    return undefined;
  }
}

export function decodeHex(hex: string): ArrayBuffer {
  const clean = hex.trim();

  if (clean.length % 2 !== 0) {
    throw new Error("Invalid hex length");
  }

  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error("Invalid hex characters");
  }

  const bytes = new Uint8Array(clean.length / 2);

  for (let index = 0; index < clean.length; index += 2) {
    bytes[index / 2] = parseInt(clean.slice(index, index + 2), 16);
  }

  return bufferOf(bytes);
}

export async function aesCbcDecrypt(
  encrypted: ArrayBuffer,
  keyBytes: ArrayBuffer,
  ivBytes: ArrayBuffer,
): Promise<ArrayBuffer> {
  const subtle = globalThis.crypto?.subtle ?? new SubtleCrypto();
  const ciphertext = new Uint8Array(encrypted);
  const key = new Uint8Array(keyBytes);
  const iv = new Uint8Array(ivBytes);

  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    throw new Error("Invalid AES-CBC ciphertext length");
  }

  const cryptoKey = await subtle.importKey("raw", bufferOf(key), { name: "AES-CBC" }, false, [
    "encrypt",
    "decrypt",
  ]);

  const lastBlock = ciphertext.slice(ciphertext.length - 16);
  const padBlock = new Uint8Array(16);

  for (let index = 0; index < 16; index++) {
    padBlock[index] = 0x10 ^ lastBlock[index]!;
  }

  const zeroIv = new Uint8Array(16);
  const encryptedPadBlock = new Uint8Array(
    await subtle.encrypt({ name: "AES-CBC", iv: bufferOf(zeroIv) }, cryptoKey, bufferOf(padBlock)),
  );

  const extended = new Uint8Array(ciphertext.length + 16);
  extended.set(ciphertext, 0);
  extended.set(encryptedPadBlock.slice(0, 16), ciphertext.length);

  const decrypted = new Uint8Array(
    await subtle.decrypt({ name: "AES-CBC", iv: bufferOf(iv) }, cryptoKey, bufferOf(extended)),
  );

  let end = decrypted.length;

  while (end > 0 && decrypted[end - 1] === 0) {
    end--;
  }

  return bufferOf(decrypted.slice(0, end));
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const decoded = Application.base64Decode(value);

  if (typeof decoded === "string") {
    const bytes = new Uint8Array(decoded.length);

    for (let index = 0; index < decoded.length; index++) {
      bytes[index] = decoded.charCodeAt(index);
    }

    return bufferOf(bytes);
  }

  return bufferOf(new Uint8Array(decoded));
}

function arrayBufferToBase64(data: ArrayBuffer): string {
  const encoded = Application.base64Encode(data);

  return typeof encoded === "string" ? encoded : Application.arrayBufferToASCIIString(encoded);
}

function findKeyLocations(js: string): number[] {
  const locations: number[] = [];
  let index = 0;
  const pattern = "str.charAt(";

  while (true) {
    const found = js.indexOf(pattern, index);
    if (found < 0) break;

    let cursor = found + pattern.length;

    while (cursor < js.length && !isDigitChar(js.charAt(cursor))) {
      cursor++;
    }

    const start = cursor;

    while (cursor < js.length && isDigitChar(js.charAt(cursor))) {
      cursor++;
    }

    if (start === cursor) {
      index = found + pattern.length;
      continue;
    }

    const num = Number(js.slice(start, cursor));

    if (Number.isFinite(num) && !locations.includes(num)) {
      locations.push(num);
    }

    index = cursor;
  }

  return locations;
}

function unscrambleChars(chars: string[], keys: number[]): void {
  for (const key of [...keys].reverse()) {
    const len = chars.length;

    for (let index = len - 1; index >= key; index--) {
      if (index % 2 !== 0) {
        const a = index - key;
        const b = index;
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

    if (!digit || !isDigitChar(digit)) {
      return imageList;
    }

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
  const combined = input.match(/widthnum\s*=\s*heightnum\s*=\s*(\d+)/);
  if (combined?.[1]) {
    const value = Number(combined[1]);

    return Number.isFinite(value) ? value : 0;
  }

  const width = input.match(/widthnum\s*=\s*(\d+)/)?.[1];
  if (width) {
    const value = Number(width);

    return Number.isFinite(value) ? value : 0;
  }

  const height = input.match(/heightnum\s*=\s*(\d+)/)?.[1];
  if (height) {
    const value = Number(height);

    return Number.isFinite(value) ? value : 0;
  }

  return 0;
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

function extractDescramblingKeyLogic(deobfChapterJs: string): string {
  const splitA = deobfChapterJs.split("var renImg = function(img,width,height,id){");
  if (splitA.length < 2) throw new Error("renImg pattern not found");

  const splitB = splitA[1]!.split("key = key.split(");
  if (splitB.length < 2) throw new Error("key split pattern not found");

  const before = splitB[0]!;

  return before
    .split("\n")
    .filter((line) => JS_FILTERS.every((filter) => !line.includes(filter)))
    .join("\n")
    .replace(/img\.src/g, "url");
}

function buildDescramblingKeyFunctionScript(deobfChapterJs: string): string {
  const imgkeys = extractDescramblingKeyLogic(deobfChapterJs);

  return `${REPLACE_POS_JS}
return function getDescramblingKeyInner(url) {
  var width = 0, height = 0, id = "";
  ${imgkeys}
  return typeof key !== "undefined" ? String(key) : "";
};
`;
}

function getDescramblingKeyFunction(deobfChapterJs: string): (url: string) => string {
  const cached = descramblingKeyFunctionCache.get(deobfChapterJs);
  if (cached) return cached;

  const functionConstructor = globalThis.Function;
  const scriptText = buildDescramblingKeyFunctionScript(deobfChapterJs);
  const fn = functionConstructor(scriptText)() as (url: string) => string;

  descramblingKeyFunctionCache.set(deobfChapterJs, fn);

  return fn;
}

function maybeGetDescramblingKeyViaFunction(
  deobfChapterJs: string,
  imageUrl: string,
): string | undefined {
  try {
    const key = getDescramblingKeyFunction(deobfChapterJs)(imageUrl);

    return key || undefined;
  } catch {
    return undefined;
  }
}

export function getDescramblingKey(deobfChapterJs: string, imageUrl: string): string {
  const key = maybeGetDescramblingKeyViaFunction(deobfChapterJs, imageUrl);

  if (!key) {
    throw new Error("Could not derive Mangago descrambling key");
  }

  return key;
}

function decodeDataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Invalid data URL");

  const payload = dataUrl.slice(comma + 1);
  const decoded = Application.base64Decode(payload);

  if (typeof decoded === "string") {
    const bytes = new Uint8Array(decoded.length);

    for (let index = 0; index < decoded.length; index++) {
      bytes[index] = decoded.charCodeAt(index);
    }

    return bufferOf(bytes);
  }

  return bufferOf(new Uint8Array(decoded));
}

async function loadImageFromBuffer(data: ArrayBuffer, mimeType: string): Promise<HTMLImageElement> {
  const b64 = arrayBufferToBase64(data);
  const dataUrl = `data:${mimeType};base64,${b64}`;
  const img = new Image();

  return await new Promise<HTMLImageElement>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;

      settled = true;
      reject(new Error("Image load timed out"));
    }, MANGAGO_IMAGE_LOAD_TIMEOUT_MS);

    img.onload = () => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);
      resolve(img);
    };

    img.onerror = () => {
      if (settled) return;

      settled = true;
      clearTimeout(timer);
      reject(new Error("Image load failed"));
    };

    img.src = dataUrl;

    if (img.complete && ((img.naturalWidth || 0) > 0 || (img.width || 0) > 0)) {
      if (settled) return;

      settled = true;
      clearTimeout(timer);
      resolve(img);
    }
  });
}

export async function descrambleMangagoImage(
  data: ArrayBuffer,
  key: string,
  cols: number,
  mimeType: string,
): Promise<ArrayBuffer> {
  if (!key.trim()) {
    throw new Error("Missing Mangago descrambling key");
  }

  if (!cols || cols <= 0) {
    throw new Error(`Invalid cols=${cols}`);
  }

  const src = await loadImageFromBuffer(data, mimeType);
  const width = src.naturalWidth || src.width;
  const height = src.naturalHeight || src.height;

  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid image size ${width}x${height}`);
  }

  const unitWidth = Math.floor(width / cols);
  const unitHeight = Math.floor(height / cols);

  if (unitWidth <= 0 || unitHeight <= 0) {
    throw new Error(`Invalid tile size for ${width}x${height}, cols=${cols}`);
  }

  const keyArray = key.split("a").map((part) => {
    const n = Number(part || "0");
    return Number.isFinite(n) ? n : 0;
  });

  const tileCount = cols * cols;

  if (keyArray.length < tileCount) {
    throw new Error(`Invalid key array length ${keyArray.length}, expected ${tileCount}`);
  }

  const canvas = new HTMLCanvasElement();
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D context");

  ctx.drawImage(src, 0, 0, width, height);

  for (let idx = 0; idx < tileCount; idx++) {
    const keyval = keyArray[idx] ?? 0;

    if (keyval < 0 || keyval >= tileCount) {
      continue;
    }

    const destRow = Math.floor(keyval / cols);
    const destCol = keyval - destRow * cols;

    const srcRow = Math.floor(idx / cols);
    const srcCol = idx - srcRow * cols;

    ctx.drawImage(
      src,
      srcCol * unitWidth,
      srcRow * unitHeight,
      unitWidth,
      unitHeight,
      destCol * unitWidth,
      destRow * unitHeight,
      unitWidth,
      unitHeight,
    );
  }

  return decodeDataUrlToArrayBuffer(canvas.toDataURL(mimeType));
}

export function isIncompleteMangagoChapterResult(
  parsedPageUrls: string[],
  finalPageUrls: string[],
  expectedPageCount = parsedPageUrls.length,
): boolean {
  return (
    parsedPageUrls.some((url) => url.trim().length === 0) ||
    finalPageUrls.length < parsedPageUrls.length ||
    finalPageUrls.length < expectedPageCount
  );
}

function trimTrailingNulls(value: string): string {
  let result = value;
  const nulChar = String.fromCharCode(0);

  while (result.endsWith(nulChar)) {
    result = result.slice(0, -1);
  }

  return result;
}

function cleanPageUrls(urls: string[]): string[] {
  return urls.map((url) => url.trim()).filter((url) => url.length > 0);
}

function addMangagoFragment(url: string, params: Record<string, string>): string {
  const hashIndex = url.indexOf("#");
  const baseUrl = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const fragment = hashIndex >= 0 ? url.slice(hashIndex + 1) : "";

  const parts = fragment
    .split("&")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .filter((part) => {
      const equalsIndex = part.indexOf("=");
      const rawKey = equalsIndex >= 0 ? part.slice(0, equalsIndex) : part;

      try {
        return !Object.prototype.hasOwnProperty.call(params, decodeURIComponent(rawKey));
      } catch {
        return !Object.prototype.hasOwnProperty.call(params, rawKey);
      }
    });

  for (const [key, value] of Object.entries(params)) {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }

  return `${baseUrl}#${parts.join("&")}`;
}

async function getCachedDeobfuscatedChapterJs(chapterJsUrl: string): Promise<string> {
  const cached = chapterJsCache.get(chapterJsUrl);
  if (cached) return cached;

  const obfuscatedChapterJs = await withTimeout(
    fetchText(chapterJsUrl, {
      "User-Agent": DESKTOP_USER_AGENT,
      "user-agent": DESKTOP_USER_AGENT,
      Cookie: "_m_superu=1",
      cookie: "_m_superu=1",
      Referer: `${MANGAGO_DOMAIN}/`,
      referer: `${MANGAGO_DOMAIN}/`,
    }),
    MANGAGO_CHAPTER_FETCH_TIMEOUT_MS,
    `chapter.js ${chapterJsUrl}`,
  );

  const deobfChapterJs = sojsonV4Decode(obfuscatedChapterJs);
  chapterJsCache.set(chapterJsUrl, deobfChapterJs);

  return deobfChapterJs;
}

function resolveMangagoImageUrls(
  rawUrls: string[],
  deobfChapterJs: string,
  cols: number,
  refUrl: string,
): string[] {
  return rawUrls.map((rawUrl) => {
    const cleanRawUrl = stripFragment(rawUrl).trim();

    if (!cleanRawUrl) {
      return "";
    }

    const abs = absoluteUrlFromBase(cleanRawUrl, refUrl);
    const isScrambled = isScrambledImageUrl(cleanRawUrl) || isScrambledImageUrl(abs);

    if (!isScrambled) {
      return addMangagoFragment(abs, {
        ref: refUrl,
      });
    }

    if (!cols) {
      console.log("[Mangago] scrambled image found but cols missing");

      return addMangagoFragment(abs, {
        ref: refUrl,
      });
    }

    const key =
      maybeGetDescramblingKeyViaFunction(deobfChapterJs, cleanRawUrl) ??
      maybeGetDescramblingKeyViaFunction(deobfChapterJs, abs);

    if (!key) {
      console.log(`[Mangago] failed to get descrambling key for ${abs}`);

      return addMangagoFragment(abs, {
        ref: refUrl,
      });
    }

    return addMangagoFragment(abs, {
      descrambler: "mangago",
      desckey: key,
      cols: String(cols),
      ref: refUrl,
    });
  });
}

async function parseMangagoPageUrlsFromHtml(
  html: string,
  refUrl: string,
): Promise<{ urls: string[]; totalPages: number }> {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (match) => match[1] ?? "",
  );

  const imgsrcsScript = scripts.find((script) => script.includes("imgsrcs"));
  if (!imgsrcsScript) throw new Error("Could not find imgsrcs script");

  const imgsrcsRaw = extractImgsrcs(imgsrcsScript);
  if (!imgsrcsRaw) throw new Error("Could not extract imgsrcs");

  const chapterJsMatch =
    html.match(/<script\b[^>]+src=["']([^"']*chapter\.js[^"']*)["'][^>]*>/i) ??
    html.match(/src=["']([^"']*chapter\.js[^"']*)["']/i);

  const chapterJsSrc = chapterJsMatch?.[1];

  if (!chapterJsSrc) throw new Error("Could not find chapter.js URL");

  const chapterJsUrl = absoluteUrlFromBase(chapterJsSrc, refUrl);
  const deobfChapterJs = await getCachedDeobfuscatedChapterJs(chapterJsUrl);

  const keyHex = findHexEncodedVariable(deobfChapterJs, "key");
  const ivHex = findHexEncodedVariable(deobfChapterJs, "iv");

  if (!keyHex) throw new Error("Could not find AES key");
  if (!ivHex) throw new Error("Could not find AES IV");

  const encrypted = base64ToArrayBuffer(imgsrcsRaw);
  const decryptedBuffer = await aesCbcDecrypt(encrypted, decodeHex(keyHex), decodeHex(ivHex));

  const decryptedText = trimTrailingNulls(
    Application.arrayBufferToUTF8String(decryptedBuffer),
  ).replace(/,+$/g, "");

  const imageList = unscrambleImageList(decryptedText, deobfChapterJs);
  const cols = findCols(deobfChapterJs);

  const slots = imageList.split(",").map((part) => part.trim());
  const totalPages = extractTotalPages(html) ?? slots.length;

  // Pad slots up to totalPages so sparse mirror responses (e.g. mangago.zone
  // returning only the current chunk) can be merged slot-by-slot from
  // additional anchor-page fetches in getMangagoPageUrls.
  while (slots.length < totalPages) slots.push("");

  const urls = resolveMangagoImageUrls(slots, deobfChapterJs, cols, refUrl);

  console.log(
    `[Mangago] refUrl=${refUrl} cols=${cols} totalPages=${totalPages} slots=${slots.length} nonblank=${
      urls.filter((url) => url.trim().length > 0).length
    }`,
  );

  return { urls, totalPages };
}

function extractTotalPages(html: string): number | undefined {
  const match = html.match(/total_pages\s*=\s*(\d+)/);
  if (!match) return undefined;

  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function extractCurlTemplate(html: string): string | undefined {
  const match = /<input\b(?=[^>]*\bid=["']curl["'])[^>]*\bvalue=["']([^"']+)["'][^>]*>/i.exec(html);

  return match?.[1]?.trim() || undefined;
}

function extractNextPageHref(html: string): string | undefined {
  const anchor = /<a\b(?=[^>]*\bclass=["'][^"']*next_page[^"']*["'])[^>]*>/i.exec(html)?.[0];
  if (!anchor) return undefined;

  return /\bhref=["']([^"']+)["']/i.exec(anchor)?.[1]?.trim() || undefined;
}

function isScrambledImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("cspiclink.com") ||
    lower.includes("hfastimage.com") ||
    lower.includes("mangapicgallery.com") ||
    lower.includes("mangagoimg.com")
  );
}

async function fetchMangagoChapterHtml(
  chapterUrl: string,
  noCache: boolean,
  preferredMirror?: string,
): Promise<MangagoChapterHtml> {
  const candidates: string[] = [];
  const addCandidate = (url: string): void => {
    if (!candidates.includes(url)) candidates.push(url);
  };

  if (preferredMirror) addCandidate(withMirror(chapterUrl, preferredMirror));
  addCandidate(chapterUrl);
  for (const mirror of MANGAGO_READER_MIRRORS) {
    addCandidate(withMirror(chapterUrl, mirror));
  }

  let lastError = "unknown error";

  for (const candidate of candidates) {
    try {
      const html = await withTimeout(
        fetchText(candidate, {
          "User-Agent": DESKTOP_USER_AGENT,
          "user-agent": DESKTOP_USER_AGENT,
          Cookie: "_m_superu=1",
          cookie: "_m_superu=1",
          Referer: `${MANGAGO_DOMAIN}/`,
          referer: `${MANGAGO_DOMAIN}/`,
          ...(noCache
            ? {
                "Cache-Control": "no-cache",
                "cache-control": "no-cache",
                Pragma: "no-cache",
                pragma: "no-cache",
              }
            : {}),
        }),
        MANGAGO_CHAPTER_FETCH_TIMEOUT_MS,
        `chapter html ${candidate}`,
      );

      if (html.includes("imgsrcs")) {
        return {
          html,
          loadedUrl: candidate,
          preferredMirror: originOf(candidate) ?? preferredMirror,
        };
      }

      lastError = "response did not contain imgsrcs";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(`[Mangago] no mirror returned a usable chapter page: ${lastError}`);
}

export function buildReaderPageUrl(
  refUrl: string,
  pageNumber: number,
  curlTemplate?: string,
  nextPageHref?: string,
): string {
  if (curlTemplate?.includes("{page}")) {
    const template = curlTemplate.trim().replace(/^\/+/, "");
    const firstSegment = template.split("/")[0];

    try {
      const parsed = new URL(nextPageHref ? absoluteUrlFromBase(nextPageHref, refUrl) : refUrl);
      const segments = parsed.pathname.split("/").filter(Boolean);
      let prefix: string | undefined;
      const host = parsed.hostname.replace(/^www\./, "");

      if (
        host.endsWith(MANGAGO_DOMAIN_HOST) &&
        segments.length > 3 &&
        segments[0] === "read-manga" &&
        segments[2] === firstSegment
      ) {
        prefix = `${MANGAGO_DOMAIN}/read-manga/${segments[1]}`;
      } else if (segments[0] === firstSegment) {
        prefix = `${parsed.protocol}//${parsed.host}`;
      }

      if (prefix) {
        return `${prefix.replace(/\/+$/, "")}/${template.replace("{page}", String(pageNumber))}`;
      }
    } catch {
      // Fall through to the direct pg-N shape below.
    }
  }

  try {
    const parsed = new URL(refUrl, MANGAGO_DOMAIN);

    if (/\/pg-\d+\/?$/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/\/pg-\d+\/?$/i, `/pg-${pageNumber}/`);
    } else {
      parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/pg-${pageNumber}/`;
    }

    parsed.search = "";
    parsed.hash = "";

    return parsed.toString();
  } catch {
    // Fallback for environments without native URL (e.g. paperback VM sandbox)
    const cleaned = stripQueryAndFragment(refUrl);

    if (/\/pg-\d+\/?$/i.test(cleaned)) {
      return cleaned.replace(/\/pg-\d+\/?$/i, `/pg-${pageNumber}/`);
    }

    return `${cleaned.replace(/\/+$/, "")}/pg-${pageNumber}/`;
  }
}

/**
 * Returns the 1-based reader page numbers that must be fetched to cover every
 * blank slot. Starting from each blank slot, it advances by `chunkSize` so a
 * single fetch is planned per missing window instead of per missing page.
 */
export function planSparseAnchorPages(slots: string[], chunkSize: number): number[] {
  const anchors: number[] = [];
  const stride = Math.max(1, chunkSize);
  let index = 0;

  while (index < slots.length) {
    if (!slots[index]!.trim()) {
      anchors.push(index + 1);
      index += stride;
    } else {
      index += 1;
    }
  }

  return anchors;
}

/**
 * Copies non-blank entries from `incoming` into blank slots of `master`
 * (matched by index) and returns how many slots were filled.
 */
export function mergeImageSlots(master: string[], incoming: string[]): number {
  let filled = 0;
  const length = Math.min(master.length, incoming.length);

  for (let index = 0; index < length; index++) {
    if (!master[index]!.trim() && incoming[index]!.trim()) {
      master[index] = incoming[index]!;
      filled += 1;
    }
  }

  return filled;
}

export async function getMangagoPageUrls(chapterUrl: string): Promise<string[]> {
  const primaryUrl = normalizeMangagoChapterUrl(chapterUrl);

  const cached = mangagoPageUrlsCache.get(primaryUrl);
  if (cached && cached.length > 0) {
    return cached;
  }

  console.log(`[Mangago] loading chapter pages from ${primaryUrl}`);

  const initial = await fetchMangagoChapterHtml(primaryUrl, false);
  const html = initial.html;
  let preferredMirror = initial.preferredMirror;

  if (!html.includes("imgsrcs")) {
    throw new Error("Chapter HTML did not contain imgsrcs");
  }

  const parsed = await parseMangagoPageUrlsFromHtml(html, initial.loadedUrl);
  const master = parsed.urls.slice();
  const curlTemplate = extractCurlTemplate(html);
  const nextPageHref = extractNextPageHref(html);

  // Some mirrors (e.g. mangago.zone) return only the current chunk of
  // `imgsrcs` instead of the full list, leaving blank slots in `master`.
  // Walk those blanks by fetching the corresponding reader pages and merging
  // slot-by-slot. Matches keiyoushi PR #13431 / mangasteen behaviour.
  let blanks = master.filter((url) => !url.trim()).length;

  if (blanks > 0 && parsed.totalPages > 1) {
    // Use a single-page stride: each anchor fetch fills the slot it targets;
    // we re-scan blanks after every merge so chunky responses still converge.
    const visited = new Set<number>();
    let anchors = planSparseAnchorPages(master, 1);

    for (const anchor of anchors) {
      if (visited.has(anchor)) continue;
      visited.add(anchor);

      if (anchor < 1 || anchor > parsed.totalPages) continue;

      const anchorUrl = buildReaderPageUrl(initial.loadedUrl, anchor, curlTemplate, nextPageHref);
      console.log(`[Mangago] sparse imgsrcs: fetching anchor pg-${anchor} (${anchorUrl})`);

      let anchorResult: MangagoChapterHtml;
      try {
        anchorResult = await fetchMangagoChapterHtml(anchorUrl, true, preferredMirror);
        preferredMirror = anchorResult.preferredMirror;
      } catch (error) {
        console.log(`[Mangago] anchor fetch failed for pg-${anchor}: ${String(error)}`);
        continue;
      }

      const anchorHtml = anchorResult.html;
      if (!anchorHtml.includes("imgsrcs")) continue;

      let anchorParsed: { urls: string[]; totalPages: number };
      try {
        anchorParsed = await parseMangagoPageUrlsFromHtml(anchorHtml, anchorResult.loadedUrl);
      } catch (error) {
        console.log(`[Mangago] anchor parse failed for pg-${anchor}: ${String(error)}`);
        continue;
      }

      const filled = mergeImageSlots(master, anchorParsed.urls);
      blanks -= filled;

      if (blanks <= 0) break;

      // Recompute anchors so we skip slots that the latest chunk filled in.
      anchors = planSparseAnchorPages(master, 1);
    }
  }

  const finalUrls = cleanPageUrls(master);

  console.log(
    `[Mangago] final pages=${finalUrls.length}, uniqueBaseUrls=${
      new Set(finalUrls.map(stripFragment)).size
    }`,
  );

  if (finalUrls.length === 0) {
    throw new Error("Could not extract Mangago page URLs");
  }

  // Only cache when we got a complete result; partial fills could otherwise
  // pin a permanently-incomplete page list across reader navigations.
  if (finalUrls.length === master.length) {
    mangagoPageUrlsCache.set(primaryUrl, finalUrls);
  }

  return finalUrls;
}
