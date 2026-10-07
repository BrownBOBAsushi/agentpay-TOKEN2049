import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ProductDescription, StoreClient, StoreVerdict } from "./StoreClient";
import { checkStoreFromBrowser, focusStoreVerdict, hiddenStoreComment, presentStoreResult } from "./store-browser";
import { STORE_INJECTION, STORE_RECEIPT, STORE_TRANSACTION, StoreResultSchema } from "./store-contract";
import { handleStoreCheck } from "./store-check";
import { POST } from "../../app/api/store/check/route";
import { MandateBundleSchema } from "../guard";
import { proposalDigest } from "../guard/receipt";
import fixture from "./fixtures/store-mandate.json";
const bundle = MandateBundleSchema.parse(fixture);
const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "");
afterEach(() => vi.restoreAllMocks());
async function result(injection: string | null) {
  vi.spyOn(Date, "now").mockReturnValue((bundle.mandate.expiry - 3600) * 1000);
  return presentStoreResult(StoreResultSchema.parse(await (await handleStoreCheck(new Request("http://local/api/store/check", {
    method: "POST", body: JSON.stringify({ injection }),
  }), bundle)).json()));
}

it("keeps the product instruction in an HTML comment until Reveal, then displays escaped text", () => {
  const props = { injection: STORE_INJECTION, revealed: false, onReveal: () => {} };
  const hidden = renderToStaticMarkup(h(ProductDescription, props));
  expect(hidden).toContain("<!-- attacker injection:");
  expect(stripComments(hidden)).not.toContain("Evil Store");
  expect(hidden).not.toContain('aria-label="Hidden checkout instruction"');
  expect(hidden).toContain('aria-expanded="false"');
  const shown = renderToStaticMarkup(h(ProductDescription, { ...props, revealed: true }));
  expect(shown).toContain('aria-expanded="true"'); expect(shown).toContain('aria-label="Hidden checkout instruction"');
  expect(shown).toContain("&lt;!-- system:"); expect(shown).toContain("Evil Store");
});
it.each(['--><img src=x onerror=alert(1)>', '--!><script>alert(1)</script>', '<!--><img src=x>'])("cannot break an edited injection out of its inert HTML comment (%s)", (injection) => {
  const html = renderToStaticMarkup(h(ProductDescription, { injection, revealed: false, onReveal: () => {} }));
  expect(stripComments(html)).not.toContain("<img"); expect(stripComments(html)).not.toContain("<script");
  expect(hiddenStoreComment(injection)).toMatch(/^<!-- attacker injection: .* -->$/);
});
it("renders the real REFUSE with returned cheque, a ring for each Diff, merchant names, and no-payment note", async () => {
  const data = await result(STORE_INJECTION);
  const html = renderToStaticMarkup(h(StoreVerdict, { bundle, result: data, testKey: true }));
  expect(html).toContain("RETURNED"); expect(html).toContain("Evil Store"); expect(html).toContain("The Corner Store");
  expect(html.match(/class="pencil-ring"/g)).toHaveLength(data.diff.length);
  for (const reason of data.reasons) expect(html).toContain(reason);
  for (const row of data.diff) expect(html).toContain(row.field);
  expect(html).toContain("No money moves here."); expect(html).toContain("test-key signature");
  expect(data.proposalDigest).toBe(proposalDigest(data.proposal));
  expect(data.proposalDigest).not.toBe(bundle.digest);
  expect(html).toContain(`title="${data.proposalDigest}"`);
  expect(html).not.toContain("In the full flow the agent now pays over x402");
});
it("renders APPROVE as CLEARED with both recorded proof links and the full-flow explanation", async () => {
  const html = renderToStaticMarkup(h(StoreVerdict, { bundle, result: await result(null), testKey: false }));
  expect(html).toContain("CLEARED"); expect(html).not.toContain("RETURNED"); expect(html).not.toContain("pencil-ring");
  expect(html).toContain("In the full flow the agent now pays over x402");
  expect(html).toContain(`href="${STORE_RECEIPT}"`); expect(html).toContain(`href="${STORE_TRANSACTION}"`);
  expect(html).toContain("real wallet signature"); expect(html).toContain('<ol');
});
it("changes the presented safety pattern when the checkout changes", async () => {
  expect((await result(STORE_INJECTION)).proposalDigest).not.toBe((await result(null)).proposalDigest);
});
it("renders native reachable controls, initial injection ON, editor length limit and preview provenance", () => {
  const html = renderToStaticMarkup(h(StoreClient, { bundle, testKey: true }));
  expect(html).toContain("The Corner Store"); expect(html).toContain("6.50 tADA");
  expect(html).toContain("preprod test ADA stands in for SGD");
  expect(html).toMatch(/<input[^>]*role="switch"[^>]*checked=""/);
  expect(html).toMatch(/<textarea[^>]*maxLength="500"/);
  expect(html).toContain('for="store-injection"'); expect(html).toContain("Send to my AI"); expect(html).toContain("Buy for 6.50 tADA");
  expect(html).toContain("Test-key Mandate for this preview");
});
it("posts only the current injection and validates the actual local route response", async () => {
  vi.spyOn(Date, "now").mockReturnValue((bundle.mandate.expiry - 3600) * 1000);
  const fetchCheck = vi.fn<typeof fetch>(async (_url, init) => POST(new Request("http://local/api/store/check", init)));
  expect((await checkStoreFromBrowser(STORE_INJECTION, fetchCheck)).verdict).toBe("REFUSE");
  expect(fetchCheck.mock.calls[0][0]).toBe("/api/store/check");
  expect(fetchCheck.mock.calls[0][1]).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ injection: STORE_INJECTION }) });
});
it("gives a controlled retry message instead of reflecting API errors or invalid success bodies", async () => {
  for (const response of [new Response("private-response-detail", { status: 503 }), Response.json({ verdict: "APPROVE" })]) {
    await expect(checkStoreFromBrowser(null, async () => response)).rejects.toThrow("Guard check could not finish. Try sending again.");
  }
});
it("focuses the outcome and respects reduced motion when moving from the shop to the desk", () => {
  const target = { focus: vi.fn(), scrollIntoView: vi.fn() };
  focusStoreVerdict(target, true); expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(target.scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "start" });
  focusStoreVerdict(target, false); expect(target.scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "start" });
});
