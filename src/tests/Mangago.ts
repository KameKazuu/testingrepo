import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { Mangago } from "../Mangago/main.js";
import { parseChapters } from "../Mangago/parsers.js";
import sourceInfo from "../Mangago/pbconfig.js";
import { canonicalReaderUrl } from "../Mangago/utils.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Mangago tests", logger);

  // Regression: the numeric /chapter/<mid>/<cid>/ reader (and its windowed
  // sub-pages) is served ONLY by the mirror hosts and 404s on www.mangago.me, so
  // canonicalReaderUrl must KEEP a mirror host for numeric URLs while still
  // pinning /read-manga/ to www.mangago.me — even when the read-manga link comes
  // from a mirror host. This runs in the Paperback test runtime, which exercises
  // the same URL polyfill as the device (where new URL(absolute, base) can fold
  // the host back to www.mangago.me — the bug that truncated windowed chapters
  // to 5 images). String-based detection keeps it deterministic here and on-device.
  suite.test("mirror numeric reader URLs stay on mirror hosts", async () => {
    // numeric mirror reader + windowed sub-page: host preserved
    expect(canonicalReaderUrl("https://www.mangago.zone/chapter/55472/2239666/6/")).to.equal(
      "https://www.mangago.zone/chapter/55472/2239666/6/",
    );
    expect(canonicalReaderUrl("https://www.youhim.me/chapter/55472/2239666/")).to.equal(
      "https://www.youhim.me/chapter/55472/2239666/",
    );
    // read-manga is pinned to www.mangago.me even when linked from a mirror host
    expect(
      canonicalReaderUrl("https://www.youhim.me/read-manga/an_unseemly_lady/uu/chapter-1/"),
    ).to.equal("https://www.mangago.me/read-manga/an_unseemly_lady/uu/chapter-1/");
    // a stale www.mangago.me numeric URL stays on .me (the mirror sweep then
    // finds a working host); it must NOT be invented onto a mirror.
    expect(canonicalReaderUrl("https://www.mangago.me/chapter/55472/2239666/")).to.equal(
      "https://www.mangago.me/chapter/55472/2239666/",
    );
    // a doubled-host stale entry collapses to the inner (mirror) host, once.
    expect(
      canonicalReaderUrl("https://www.mangago.me/https://www.mangago.zone/chapter/55472/2239666/"),
    ).to.equal("https://www.mangago.zone/chapter/55472/2239666/");

    // A chapter list that only exposes a numeric mirror link keeps the mirror
    // host in the stored originalChapterUrl (so the reader fetches it there).
    const chapters = parseChapters(
      `
        <table id="chapter_table"><tbody>
          <tr>
            <td><a class="chico" href="https://www.mangago.zone/chapter/55472/2239666/">Ch.131 : [Official]</a></td>
            <td class="uk-table-shrink"><a>loraine</a></td>
            <td>Mar 4, 2026</td>
          </tr>
        </tbody></table>
      `,
      {
        mangaId: "/read-manga/an_unseemly_lady_wicked_dragons/",
        mangaInfo: { primaryTitle: "An Unseemly Lady" },
      },
    );

    const originalChapterUrl = (
      chapters[0] as (typeof chapters)[number] & {
        additionalInfo?: { originalChapterUrl?: string };
      }
    ).additionalInfo?.originalChapterUrl;

    expect(originalChapterUrl).to.equal("https://www.mangago.zone/chapter/55472/2239666/");
  });

  // Drive the tests with concrete inputs (like keiyoushi/the test-extension):
  // a title search ("love") rather than the empty-title genre browse, and a
  // known manga id. Chapter tests stay enabled so the multimode reader walk is
  // still exercised when the runner can actually reach the site.
  registerDefaultTests(suite, Mangago, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "love" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["/read-manga/love_is_an_illusion/"],
    },
  });

  await suite.run();
}
