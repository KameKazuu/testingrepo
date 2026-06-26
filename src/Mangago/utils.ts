import { DESKTOP_USER_AGENT } from "./models";
import { FETCH_TIMEOUT_MS, fetchText } from "./network";

// ── Caches: chapter.js (deobfuscated) and final page URLs. These stop the
//    extension from refetching on every retry/re-open, which is the main
//    source of redundant requests that trip the 5/30 rate limit. ──
const mangagoPageUrlsCache = new Map<string, string[]>();
const chapterJsCache = new Map<string, string>();

// Reader mirrors in preference order. mangago.me is LAST: it currently 404s
// every numeric reader page (/chapter/ID/CID/N/) even though it serves cover
// and search pages fine, so for the reader walk we treat it as a last resort.
const MANGAGO_READER_MIRRORS = [
  "https://www.mangago.zone",
  "https://www.youhim.me",
  "https://www.mangago.me",
];

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

// Decrypt + unscramble a single reader page's imgsrcs blob into raw image URLs.
function decodeImgsrcsBlob(
  imgsrcsRaw: string,
  deobfChapterJs: string,
  keyHex: string,
  ivHex: string,
): Promise<string[]> {
  const encrypted = base64ToArrayBuffer(imgsrcsRaw);

  return aesCbcDecrypt(encrypted, decodeHex(keyHex), decodeHex(ivHex)).then((decryptedBuffer) => {
    let decryptedText = new TextDecoder().decode(decryptedBuffer);

    const nulChar = String.fromCharCode(0);
    while (decryptedText.endsWith(nulChar)) {
      decryptedText = decryptedText.slice(0, -1);
    }

    decryptedText = decryptedText.replace(/,+$/g, "");

    const imageList = unscrambleImageList(decryptedText, deobfChapterJs);

    return imageList
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
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
  const match = /total_pages\s*=\s*(\d+)/.exec(html);
  const value = match ? Number(match[1]) : 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// The reader-page URL template, e.g. "/chapter/35134/2096487/{page}/".
function extractCurlTemplate(html: string): string | undefined {
  const match = /<input[^>]*id=["']curl["'][^>]*value=["']([^"']+)["']/i.exec(html);
  return match?.[1]?.trim();
}

// The site's own multimode flag: `_multimode = "1"` for paginated readers
// (page 1 holds only a slice of the chapter), `""` for single-page readers
// (page 1 holds every image).
function extractMultimode(html: string): string {
  const match = /_multimode\s*=\s*["']([^"']*)["']/.exec(html);
  return match?.[1] ?? "";
}

// The reader's "next page" anchor href, used as a concrete example path when a
// region serves the curl template without its full path prefix (read-manga).
function extractNextPageHref(html: string): string | undefined {
  const anchor = /<a\b(?=[^>]*class=["'][^"']*next_page[^"']*["'])[^>]*>/i.exec(html)?.[0];
  if (!anchor) return undefined;
  const href = /\bhref=["']([^"']+)["']/i.exec(anchor)?.[1];
  return href?.trim();
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

async function getCachedDeobfChapterJs(chapterJsUrl: string): Promise<string> {
  const cached = chapterJsCache.get(chapterJsUrl);
  if (cached) return cached;

  const obfuscatedChapterJs = await fetchText(chapterJsUrl, {}, FETCH_TIMEOUT_MS);
  const deobf = sojsonV4Decode(obfuscatedChapterJs);
  chapterJsCache.set(chapterJsUrl, deobf);
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

// Build the URL for reader page N. Prefer the site's next_page href as the
// concrete example path and merge the template into it; fall back to resolving
// the template against the loaded URL.
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

// Fetch one reader page, trying mirrors in order (preferred host first) until
// one returns a page that actually contains imgsrcs. Returns the imgsrcs blob
// and the origin that served it, so the caller can stick with a working mirror
// and stop re-probing dead ones (mangago.me 404s every numeric reader page).
async function fetchReaderPage(
  template: string,
  baseUrl: string,
  page: number,
  nextPageHref: string | undefined,
  preferredOrigin: string | undefined,
): Promise<{ imgsrcs: string; origin: string } | undefined> {
  const pageUrl = buildReaderPageUrl(template, baseUrl, page, nextPageHref);

  const origins: string[] = [];
  const pushOrigin = (o: string | undefined): void => {
    if (o && !origins.includes(o)) origins.push(o);
  };
  pushOrigin(preferredOrigin);
  pushOrigin(originOf(baseUrl));
  for (const mirror of MANGAGO_READER_MIRRORS) pushOrigin(originOf(mirror));

  for (const origin of origins) {
    const url = withMirror(pageUrl, origin);
    try {
      const pageHtml = await fetchText(
        url,
        {
          "user-agent": DESKTOP_USER_AGENT,
          cookie: "_m_superu=1",
        },
        FETCH_TIMEOUT_MS,
      );
      const imgsrcs = extractImgsrcsFromHtml(pageHtml);
      if (imgsrcs) return { imgsrcs, origin };
    } catch {
      // Try the next mirror.
    }
  }
  return undefined;
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
  let loadedUrl = chapterUrl;
  const tried = new Set<string>();
  const candidates = [chapterUrl, ...MANGAGO_READER_MIRRORS.map((m) => withMirror(chapterUrl, m))];

  for (const candidate of candidates) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);

    try {
      const attempt = await fetchText(
        candidate,
        {
          "user-agent": DESKTOP_USER_AGENT,
          cookie: "_m_superu=1",
        },
        FETCH_TIMEOUT_MS,
      );
      if (attempt.includes("imgsrcs")) {
        html = attempt;
        loadedUrl = candidate;
        break;
      }
    } catch {
      // Try the next mirror.
    }
  }

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

  // Images present on the first reader page.
  const firstImages = await decodeImgsrcsBlob(imgsrcsRaw, deobfChapterJs, keyHex, ivHex);

  const totalPages = extractTotalPages(html);
  const curlTemplate = extractCurlTemplate(html);
  const nextPageHref = extractNextPageHref(html);
  const multimodeFlag = extractMultimode(html);

  console.log(
    `[Mangago] chapter ${chapterUrl} | firstImages=${firstImages.length} total_pages=${totalPages} multimode=${
      multimodeFlag || "(none)"
    } curl=${curlTemplate ?? "none"}`,
  );

  // `total_pages` is the number of READER PAGES, not images. In a multimode
  // reader each page holds only a slice of the chapter (often ~5 images) and
  // the page parameter is a plain 1-based counter, so the remaining images live
  // on pages 2..total_pages. A single-page reader (`_multimode` empty) already
  // has every image on page 1.
  const isMultimode =
    !!curlTemplate && totalPages > 1 && (multimodeFlag === "1" || firstImages.length < totalPages);

  let rawImages: string[];
  let complete = true;

  if (!isMultimode) {
    console.log(`[Mangago] single-page path -> ${firstImages.length} images`);
    rawImages = firstImages;
  } else {
    console.log(
      `[Mangago] multimode path -> striding reader pages (page 1 already loaded, total images=${totalPages})`,
    );

    const merged: string[] = [];
    const seen = new Set<string>();
    const addImages = (imgs: string[]): number => {
      let added = 0;
      for (const img of imgs) {
        if (!seen.has(img)) {
          seen.add(img);
          merged.push(img);
          added++;
        }
      }
      return added;
    };

    addImages(firstImages);

    // Mangago's multimode reader serves one page per image: reader page N starts
    // at the Nth image and shows a forward window from there. So once we hold a
    // contiguous prefix of M images, the next image we need is at position M+1,
    // which lives on page M+1. Striding by the running image count therefore
    // advances gap-free and skips the redundant overlapping pages (3 fetches for
    // a 16-image chapter instead of 16). total_pages is also the total image
    // count, so we stop once merged reaches it.
    //
    // Stick with whichever mirror actually serves reader sub-pages so we don't
    // pay a 404 round-trip to a dead mirror (mangago.me) on every page.
    let preferredOrigin = originOf(loadedUrl);
    let lastPage = 1;
    let safety = totalPages + 6;

    while (merged.length < totalPages && safety-- > 0) {
      let page = merged.length + 1;
      if (page <= lastPage) page = lastPage + 1; // never step backwards
      if (page > totalPages) break;

      const result = await fetchReaderPage(
        curlTemplate!,
        loadedUrl,
        page,
        nextPageHref,
        preferredOrigin,
      );
      lastPage = page;

      if (!result) {
        console.log(`[Mangago] reader page ${page} unavailable on all mirrors -> stop`);
        complete = false;
        break;
      }

      preferredOrigin = result.origin;

      const pageImages = await decodeImgsrcsBlob(result.imgsrcs, deobfChapterJs, keyHex, ivHex);

      if (pageImages.length === 0) {
        console.log(`[Mangago] reader page ${page} decoded 0 images -> stop`);
        complete = false;
        break;
      }

      // A page that only repeats images we already have (a duplicate window from
      // a bad merged URL or a misbehaving mirror) means we're making no forward
      // progress. Stop instead of probing every remaining page — that wasted
      // request burst is exactly what this reader path tries to avoid.
      const added = addImages(pageImages);
      if (added === 0) {
        console.log(`[Mangago] reader page ${page} added no new images -> stop`);
        complete = false;
        break;
      }
    }

    if (merged.length < totalPages) complete = false;

    console.log(
      `[Mangago] multimode collected ${merged.length}/${totalPages} images (complete=${complete})`,
    );
    rawImages = merged;
  }

  const pages = rawImages.map((url) => annotateImageUrl(url, deobfChapterJs, cols));

  // Only cache a result we believe is complete, so a partial/rate-limited run
  // is never frozen in the cache. Single-page is always complete; multimode is
  // complete only if every reader page was fetched successfully.
  if (pages.length > 0 && complete) {
    mangagoPageUrlsCache.set(chapterUrl, pages);
  }

  return pages;
}
