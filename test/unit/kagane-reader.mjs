import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { rolldown } from "rolldown";

const temporary = await mkdtemp(path.join(tmpdir(), "kagane-reader-"));
try {
  const bundle = await rolldown({
    input: {
      utils: "src/Kagane/implementations/shared/utils.ts",
      network: "src/Kagane/services/network.ts",
      parsers: "src/Kagane/implementations/shared/parsers.ts",
    },
  });
  await bundle.write({ dir: temporary, format: "esm", entryFileNames: "[name].mjs" });
  await bundle.close();
  const state = new Map([
    ["kagane-integrity-token", "integrity"],
    ["kagane-integrity-exp", String(Date.now() + 60_000)],
    ["kagane-data-saver", false],
  ]);
  const requests = [];
  globalThis.Application = {
    getState: (key) => state.get(key),
    setState: (value, key) => state.set(key, value),
    arrayBufferToUTF8String: (data) => new TextDecoder().decode(data),
    getDefaultUserAgent: async () => "test-browser",
    scheduleRequest: async (request) => {
      requests.push(request);
      if (request.method === "POST") {
        return [
          { status: 200 },
          new TextEncoder().encode(
            JSON.stringify({
              access_token: "fresh",
              cache_url: "https://kstatic.to",
              manifest: { pages: [{ page_no: 1, page_id: "image", ext: "webp" }] },
            }),
          ).buffer,
        ];
      }
      return [{ status: 200 }, new Uint8Array([1, 2, 3]).buffer];
    },
  };
  const { buildPageUrl } = await import(pathToFileURL(path.join(temporary, "utils.mjs")));
  const { KaganeInterceptor } = await import(pathToFileURL(path.join(temporary, "network.mjs")));
  const { getBaseUrl } = await import(pathToFileURL(path.join(temporary, "parsers.mjs")));
  assert.equal(getBaseUrl(), "https://kagane.moe");
  for (const host of ["kagane.cx", "kagane.si", "kagane.net"]) {
    state.set("kagane-domain", host);
    assert.equal(getBaseUrl(), "https://kagane.moe");
  }
  state.set("kagane-domain", "kagane.org");
  assert.equal(getBaseUrl(), "https://kagane.org");
  const interceptor = new KaganeInterceptor("test");
  for (const dataSaver of [false, true]) {
    const url = buildPageUrl("https://kstatic.to", "book", "image.webp", "old", dataSaver);
    const parsed = new URL(url);
    assert.equal(
      parsed.pathname,
      `/api/v2/books/page/${dataSaver ? "datasaver" : "original"}/book/image.webp`,
    );
    assert.equal(parsed.searchParams.get("token"), "old");
    assert.equal(parsed.searchParams.has("is_datasaver"), false);
    state.set("kagane-data-saver", !dataSaver);
    for (const savedUrl of [
      url,
      `https://kstatic.to/api/v2/books/page/book/image.webp?token=old&is_datasaver=${dataSaver}`,
    ]) {
      requests.length = 0;
      const request = { url: savedUrl, method: "GET", headers: {} };
      const headers = (await interceptor.interceptRequest(request)).headers;
      assert.equal(headers.origin, "https://kagane.org");
      assert.equal(headers.referer, "https://kagane.org/");
      await interceptor.interceptResponse(
        request,
        { status: 401, headers: {} },
        new ArrayBuffer(0),
      );
      assert.equal(new URL(requests[0].url).searchParams.get("is_datasaver"), String(dataSaver));
      assert.equal(new URL(requests[1].url).pathname, parsed.pathname);
      assert.equal(new URL(requests[1].url).searchParams.get("token"), "fresh");
    }
  }
  console.log(
    "PASS default/mirror origin, both quality paths, and current/legacy token refresh preserve issued quality",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
