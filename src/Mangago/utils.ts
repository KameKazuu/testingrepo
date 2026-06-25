import { DESKTOP_USER_AGENT } from "./models";
import { fetchText } from "./network";

// ── Caches: chapter.js (deobfuscated) and final page URLs. These stop the
//    extension from refetching on every retry/re-open, which is the main
//    source of redundant requests that trip the 5/30 rate limit. ──
const mangagoPageUrlsCache = new Map<string, string[]>();
const chapterJsCache = new Map<string, string>();

// ── Known reader mirrors. parsers.ts routes chapters to mangago.zone first;
//    if that mirror ever 403s or stops returning imgsrcs we fall through to
//    the others instead of breaking the chapter. Happy path = 1 fetch. ──
const MANGAGO_READER_MIRRORS = [
  "https://www.mangago.zone",
  "https://www.mangago.me",
  "https://www.youhim.me",
];

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
  const subtle = new SubtleCrypto();

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

  return await new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image load failed"));
    img.src = dataUrl;

    if (img.complete && img.naturalWidth > 0) {
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

export async function getMangagoPageUrls(chapterUrl: string): Promise<string[]> {
  const cachedPages = mangagoPageUrlsCache.get(chapterUrl);
  if (cachedPages && cachedPages.length > 0) {
    return cachedPages;
  }

  // Fetch the chapter HTML, trying the chapter's own host first and then the
  // other mirrors only if it fails or returns no imgsrcs. On the normal path
  // this is a single request, so it does not worsen rate limiting.
  let html = "";
  const tried = new Set<string>();
  const candidates = [chapterUrl, ...MANGAGO_READER_MIRRORS.map((m) => withMirror(chapterUrl, m))];

  for (const candidate of candidates) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);

    try {
      const attempt = await fetchText(candidate, {
        "user-agent": DESKTOP_USER_AGENT,
        cookie: "_m_superu=1",
      });
      if (attempt.includes("imgsrcs")) {
        html = attempt;
        break;
      }
    } catch {
      // Try the next mirror.
    }
  }

  if (!html) throw new Error("[Mangago] no mirror returned a usable chapter page");

  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(
    (m) => m[1] ?? "",
  );

  const imgsrcsScript = scripts.find((s) => s.includes("imgsrcs"));
  if (!imgsrcsScript) throw new Error("Could not find imgsrcs script");

  const imgsrcsRaw = extractImgsrcs(imgsrcsScript);
  if (!imgsrcsRaw) throw new Error("Could not extract imgsrcs");

  const encrypted = base64ToArrayBuffer(imgsrcsRaw);

  const chapterJsMatch =
    html.match(/<script\b[^>]+src=["']([^"']*chapter\.js[^"']*)["'][^>]*>/i) ??
    html.match(/src=["']([^"']*chapter\.js[^"']*)["']/i);

  if (!chapterJsMatch?.[1]) throw new Error("Could not find chapter.js URL");

  const chapterJsUrl = absoluteUrl(chapterJsMatch[1]);

  let deobfChapterJs = chapterJsCache.get(chapterJsUrl);
  if (!deobfChapterJs) {
    const obfuscatedChapterJs = await fetchText(chapterJsUrl);
    deobfChapterJs = sojsonV4Decode(obfuscatedChapterJs);
    chapterJsCache.set(chapterJsUrl, deobfChapterJs);
  }

  const keyHex = findHexEncodedVariable(deobfChapterJs, "key");
  const ivHex = findHexEncodedVariable(deobfChapterJs, "iv");

  if (!keyHex) throw new Error("Could not find AES key");
  if (!ivHex) throw new Error("Could not find AES IV");

  const decryptedBuffer = await aesCbcDecrypt(encrypted, decodeHex(keyHex), decodeHex(ivHex));

  let decryptedText = new TextDecoder().decode(decryptedBuffer);

  const nulChar = String.fromCharCode(0);
  while (decryptedText.endsWith(nulChar)) {
    decryptedText = decryptedText.slice(0, -1);
  }

  decryptedText = decryptedText.replace(/,+$/g, "");

  const imageList = unscrambleImageList(decryptedText, deobfChapterJs);
  const cols = findCols(deobfChapterJs);

  const pages = imageList
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((url) => {
      const abs = absoluteUrl(url);

      if (!abs.includes("cspiclink")) {
        return abs;
      }

      if (!cols) {
        console.log("[Mangago] cspiclink image found but cols missing");
        return abs;
      }

      try {
        const desckey = getDescramblingKey(deobfChapterJs, abs);
        return `${abs}#desckey=${encodeURIComponent(desckey)}&cols=${encodeURIComponent(
          String(cols),
        )}`;
      } catch (error) {
        console.log(
          `[Mangago] failed to get descrambling key: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return abs;
      }
    });

  if (pages.length > 0) {
    mangagoPageUrlsCache.set(chapterUrl, pages);
  }

  return pages;
}
