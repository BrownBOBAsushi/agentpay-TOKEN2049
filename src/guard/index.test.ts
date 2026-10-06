import { expect, test } from "vitest";
import * as guard from "./index";

test("loads the empty guard-core module", () => {
  expect(Object.keys(guard)).toEqual([]);
});
