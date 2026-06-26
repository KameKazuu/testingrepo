import { type TestLogger } from "@paperback/types";

import { Mangago } from "../Mangago/main.js";
import sourceInfo from "../Mangago/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Mangago tests", logger);

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
