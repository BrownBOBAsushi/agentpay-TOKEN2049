import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Address, KeyHash, PrivateKey } from "@evolution-sdk/evolution";
import { expect, test, vi } from "vitest";
import { signReceipt, proposalDigest, type GuardReceipt } from "../guard/receipt";
import { landingBundle, landingProposal, landingVerdict } from "./landing";
import { loadReceipt } from "./receipt-data.server";
import { ReceiptView } from "./ReceiptView";
vi.mock("server-only", () => ({}));

// TEST ONLY: fixed public seed, never used for funds.
const privateKeyHex = "02".repeat(32);
const address = Address.toBech32(Address.fromHex(`60${KeyHash.toHex(KeyHash.fromPrivateKey(PrivateKey.fromHex(privateKeyHex)))}`));
const taskId = "receipt-test";
const receipt: GuardReceipt = { ...landingVerdict(1791330000), v: 1, taskId, ts: 1791330000,
  mandateDigest: landingBundle.digest, proposalDigest: proposalDigest(landingProposal) };
const signed = signReceipt(receipt, { privateKeyHex, address });
const description = JSON.stringify({ mandateBundle: landingBundle, proposal: landingProposal });
const options = { origin: "https://api.preprod.sokosumi.com", apiKey: "KEY123", guardAddress: address };
function fake(settings: { status?: string; taskStatus?: number; comment?: string; description?: string;
  anchor?: unknown; paid?: boolean; receiptStatus?: number } = {}) {
  return vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.method).toBe("GET");
    expect(init?.headers).toHaveProperty("Authorization", "Bearer KEY123");
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBeUndefined();
    expect(init).toHaveProperty("next.revalidate", 60);
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/events")) return Response.json({ data: [{ status: "COMPLETED", comment: settings.comment ?? JSON.stringify(signed),
      ...(settings.paid ? { masumiPayment: { paymentId: "test" } } : {}) }] });
    if (path.endsWith("/receipt")) return Response.json({ data: settings.anchor ?? null }, { status: settings.receiptStatus ?? 200 });
    return Response.json({ data: { id: taskId, status: settings.status ?? "COMPLETED", description: settings.description ?? description } }, { status: settings.taskStatus ?? 200 });
  });
}
const render = async (fetcher: typeof fetch, id = taskId) => renderToStaticMarkup(createElement(ReceiptView, { data: await loadReceipt(id, { ...options, fetch: fetcher }) }));

test("REFUSE renders signed reasons, two-field Diff, verified identity and separate cheques", async () => {
  const html = await render(fake());
  expect(html).toContain("PAYEE_MISMATCH"); expect(html).toContain("AMOUNT_MISMATCH");
  expect(html.match(/MUST NOT/g)).toHaveLength(4); // Two full-width Diff lines and two cheque annotations.
  expect(html).toContain("Guard signature valid"); expect(html).toContain("Signed Mandate");
  expect(html).toContain("Presented copy"); expect(html).toContain("Free rehearsal — no payment");
  expect(html).toContain(signed.digest); expect(html).not.toContain("KEY123");
});
test("APPROVE renders CLEARED", async () => {
  const proposal = { ...landingProposal, requirements: { ...landingProposal.requirements, payTo: landingBundle.mandate.payee, amount: landingBundle.mandate.amount } };
  const approved = signReceipt({ ...receipt, proposalDigest: proposalDigest(proposal), verdict: "APPROVE", reasons: [], diff: [] }, { privateKeyHex, address });
  const html = await render(fake({ comment: JSON.stringify(approved), description: JSON.stringify({ mandateBundle: landingBundle, proposal }) }));
  expect(html).toContain("CLEARED"); expect(html).toContain("amount · matches"); expect(html).not.toContain("MUST NOT");
});
test("tampered receipt shows Signature INVALID", async () => {
  expect(await render(fake({ comment: JSON.stringify({ ...signed, digest: "a".repeat(64) }) }))).toContain("Signature INVALID");
});
test.each([
  [{ taskStatus: 404 }, "No Guard Receipt for this Task"],
  [{ status: "RUNNING" }, "Guard Check in progress"],
  [{ comment: "not a receipt" }, "This Task&#x27;s result is not a Guard Receipt"],
  [{ taskStatus: 503 }, "Core is unreachable"],
] as const)("renders honest state %j", async (settings, text) => {
  expect(await render(fake(settings))).toContain(text);
});
test("progress makes no events or settlement calls", async () => {
  const fetcher = fake({ status: "READY" }); await render(fetcher); expect(fetcher).toHaveBeenCalledTimes(1);
});
test("paid receipt shows settlement and preprod transaction", async () => {
  const html = await render(fake({ paid: true, anchor: { settled: true, onChainState: "ResultSubmitted", txHash: "a".repeat(64) } }));
  expect(html).toContain(`https://preprod.cardanoscan.io/transaction/${"a".repeat(64)}`);
  expect(html).toContain("ResultSubmitted"); expect(html).not.toContain("Free rehearsal");
});
test("missing paid settlement does not guess a free task", async () => {
  expect(await render(fake({ paid: true, receiptStatus: 404 }))).toContain("Core is unreachable");
  expect(await render(fake({ receiptStatus: 404 }))).toContain("Free rehearsal");
});
test("zero digest is unavailable and mismatched inputs do not render cheques", async () => {
  const zero = signReceipt({ ...receipt, mandateDigest: "0".repeat(64) }, { privateKeyHex, address });
  const html = await render(fake({ comment: JSON.stringify(zero) }));
  expect(html).toContain("unavailable"); expect(html).not.toContain("0".repeat(64));
  expect(html).toContain("Task inputs do not match"); expect(html).not.toContain("Signed Mandate");
});
test("example uses committed data without Core or credentials", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const data = await loadReceipt("example", { fetch: fetcher });
  const html = renderToStaticMarkup(createElement(ReceiptView, { data }));
  expect(html).toContain("Illustrative example"); expect(html).toContain("AMOUNT_MISMATCH");
  expect(html).not.toContain("Guard signature valid"); expect(fetcher).not.toHaveBeenCalled();
});
test("transport errors cannot expose key or server body", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("KEY123 private body"));
  const html = await render(fetcher); expect(html).toContain("Core is unreachable"); expect(html).not.toContain("KEY123");
});
test("pagination finds the completed event", async () => {
  const fallback = fake();
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/events") && !url.search) return Response.json({ data: [{ status: "RUNNING" }], meta: { pagination: { nextCursor: "next" } } });
    return fallback(input, init);
  });
  expect(await render(fetcher)).toContain("Guard signature valid");
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith("?cursor=next"))).toBe(true);
});


test("all Core GETs opt into 60-second Next caching, including unknown tasks", async () => {
  const fetcher = fake(); await render(fetcher);
  expect(fetcher).toHaveBeenCalledTimes(3);
  for (const [, init] of fetcher.mock.calls) {
    expect(init).toHaveProperty("next.revalidate", 60);
    expect(init?.cache).toBeUndefined();
  }
  const missing = fake({ taskStatus: 404 });
  expect(await render(missing, "unknown-task")).toContain("No Guard Receipt for this Task");
  expect(missing.mock.calls[0][1]).toHaveProperty("next.revalidate", 60);
});
test("Diff shows human tADA amounts, atomic detail and plain digest labels", async () => {
  const html = await render(fake());
  const diff = html.slice(html.indexOf('id="receipt-diff"'), html.indexOf('aria-label="Mandate and Spend Proposal"'));
  expect(diff).toContain("2 tADA"); expect(diff).toContain("2,000,000 lovelace");
  expect(diff).toContain("9 tADA</del>"); expect(diff).toContain("9,000,000 lovelace");
  for (const label of ["Receipt digest", "Mandate digest", "Proposal digest"]) {
    expect(html).toContain(label); expect(html).toContain(`Copy ${label}`);
  }
});
