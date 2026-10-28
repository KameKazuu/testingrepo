import { type TestLogger } from "@paperback/types";

import { Kagane } from "../Kagane/main.js";
import sourceInfo from "../Kagane/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("Kagane tests", logger);
  registerDefaultTests(suite, Kagane, sourceInfo);

  await suite.run();
}
