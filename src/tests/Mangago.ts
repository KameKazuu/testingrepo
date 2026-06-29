import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { Mangago } from "../Mangago/main.js";
import { parseChapters } from "../Mangago/parsers.js";
import sourceInfo from "../Mangago/pbconfig.js";
import { canonicalReaderUrl } from "../Mangago/utils.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Mangago tests", logger);

  suite.test("mirror numeric reader URLs stay on mirror hosts", async () => {
    expect(canonicalReaderUrl("https://www.mangago.zone/chapter/55472/2239666/6/")).to.equal(
      "https://www.mangago.zone/chapter/55472/2239666/6/",
    );
    expect(canonicalReaderUrl("https://www.youhim.me/chapter/55472/2239666/")).to.equal(
      "https://www.youhim.me/chapter/55472/2239666/",
    );
    expect(
      canonicalReaderUrl("https://www.youhim.me/read-manga/an_unseemly_lady/uu/chapter-1/"),
    ).to.equal("https://www.mangago.me/read-manga/an_unseemly_lady/uu/chapter-1/");

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
