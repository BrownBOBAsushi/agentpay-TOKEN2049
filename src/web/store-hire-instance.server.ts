import "server-only";
import { MandateBundleSchema } from "../guard/bundle";
import fixture from "./fixtures/store-mandate.json";
import { createStoreHireService } from "./store-hire.server";

// Shared by both routes within one server instance. No credentials enter the browser graph.
export const storeHire = createStoreHireService({ bundle: MandateBundleSchema.parse(fixture), env: () => process.env,
  fetch: (input, init) => fetch(input, init) });
