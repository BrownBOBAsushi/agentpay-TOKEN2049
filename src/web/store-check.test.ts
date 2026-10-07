import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../../app/api/store/check/route";
import { handleStoreCheck } from "./store-check";
import { STORE_INJECTION } from "./store-contract";
import { MandateBundleSchema } from "../guard";
import fixture from "./fixtures/store-mandate.json";

const bundle = MandateBundleSchema.parse(fixture);

afterEach(() => vi.restoreAllMocks());
function request(body: unknown) {
  return new Request("http://local/api/store/check", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}
function clock() { vi.spyOn(Date, "now").mockReturnValue((bundle.mandate.expiry - 3600) * 1000); }
it("runs the actual route and cryptographic Guard: Figma injection returns two mismatches", async () => {
  clock(); const response = await POST(request({ injection: STORE_INJECTION })); const data = await response.json();
  expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(data).toMatchObject({ verdict: "REFUSE", reasons: ["PAYEE_MISMATCH", "AMOUNT_MISMATCH"] });
  expect(data.diff).toHaveLength(2); expect(data.diff.map((row: { field: string }) => row.field)).toEqual(["payee", "amount"]);
  expect(data.mandate).toEqual({ payee: bundle.mandate.payee, amount: "6500000", asset: "lovelace",
    expiry: bundle.mandate.expiry, purpose: "Latte at The Corner Store", payer: bundle.mandate.payer });
  expect(Object.keys(data).sort()).toEqual(["diff", "mandate", "proposal", "reasons", "steps", "verdict"]);
});
it("approves injection off, repeatedly, without consuming a nonce or paying", async () => {
  clock();
  for (let repeat = 0; repeat < 2; repeat++) {
    const data = await (await POST(request({ injection: null }))).json();
    expect(data).toMatchObject({ verdict: "APPROVE", reasons: [], diff: [], proposal: { requirements: { amount: "6500000", payTo: bundle.mandate.payee } } });
  }
});
it("refuses a tampered signature through the same handler, proving the Guard is real", async () => {
  clock(); const bytes = Buffer.from(bundle.coseSign1, "hex"); bytes[bytes.length - 1] ^= 1;
  const response = await handleStoreCheck(request({ injection: null }), { ...bundle, coseSign1: bytes.toString("hex") });
  expect(await response.json()).toMatchObject({ verdict: "REFUSE", reasons: ["SIG_INVALID"], diff: [] });
});
it.each([{ injection: "x".repeat(501) }, { injection: 28 }, {}, { injection: null, bundle }])("rejects invalid request shape/length without echoing it", async (body) => {
  clock(); const response = await POST(request(body));
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "Send injection as a string of at most 500 characters, or null." });
});
it("rejects malformed JSON with a controlled error", async () => {
  const response = await POST(new Request("http://local/api/store/check", { method: "POST", body: "invalid-json" }));
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "Send injection as a string of at most 500 characters, or null." });
});
it("accepts the 500-character boundary and preserves real expiry refusals", async () => {
  clock(); expect((await POST(request({ injection: "x".repeat(500) }))).status).toBe(200);
  vi.spyOn(Date, "now").mockReturnValue(bundle.mandate.expiry * 1000);
  expect(await (await POST(request({ injection: null }))).json()).toMatchObject({ verdict: "REFUSE", reasons: ["MANDATE_EXPIRED"] });
});
