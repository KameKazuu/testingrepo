import { type TestLogger } from "@paperback/types";

import { Mangago } from "../Mangago/main.js";
import sourceInfo from "../Mangago/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Mangago tests", logger);
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
