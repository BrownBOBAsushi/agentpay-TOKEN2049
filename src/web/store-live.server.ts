import "server-only";
import { timingSafeEqual } from "node:crypto";
import fixture from "./fixtures/store-mandate.json";
import { MandateBundleSchema, verifyMandate, type MandateBundle } from "../guard";

export const STORE_PAYEE = fixture.mandate.payee;
export const STORE_AMOUNT = "6500000";

export function hasStoreLiveKey(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.STORE_LIVE_KEY;
  const supplied = request.headers.get("x-store-live-key");
  if (!expected || expected.length < 32 || !supplied) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(supplied, "utf8");
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

// The live hire path calls this before it can submit any Task.
export function validateStoreMandate(input: unknown, nowSec = Math.floor(Date.now() / 1000)): MandateBundle {
  const parsed = MandateBundleSchema.safeParse(input);
  if (!parsed.success || !verifyMandate(parsed.data).ok) throw new Error("Signed Mandate verification failed.");
  const bundle = parsed.data;
  if (bundle.mandate.payee !== STORE_PAYEE || bundle.mandate.asset !== "lovelace" || bundle.mandate.amount !== STORE_AMOUNT) {
    throw new Error("Mandate must allow 6500000 lovelace to The Corner Store.");
  }
  if (bundle.mandate.expiry <= nowSec) throw new Error("Mandate has expired.");
  return bundle;
}
