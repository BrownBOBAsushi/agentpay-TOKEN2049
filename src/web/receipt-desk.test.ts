import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { landingBundle, landingProposal, landingVerdict } from "./landing";
import { ReceiptView } from "./ReceiptView";
import { fitPencilRing, roundedRingPath } from "./LandingScene";
import MandatePage from "../../app/mandate/page";
import type { ReceiptRecord } from "./receipt-types";

const now = landingBundle.mandate.expiry - 60;
const refusal = landingVerdict(now);
const base: ReceiptRecord = {
  kind: "receipt", example: false, taskId: "desk-render-test", ts: now, verdict: "REFUSE",
  reasons: refusal.reasons, diff: refusal.diff, matching: refusal.diff.length ? [] : [],
  signatureValid: true, inputsBound: true, sentinelOk: true, receiptValid: true,
  invalidReasons: [], guardAddress: "addr_test1guard", digests: { receipt: "a".repeat(64), mandate: landingBundle.digest, proposal: "b".repeat(64) },
  bundle: landingBundle, proposal: landingProposal, inputs: "available", anchor: { kind: "free" },
};
const render = (data: ReceiptRecord) => renderToStaticMarkup(createElement(ReceiptView, { data }));

test("REFUSE desk renders returned presented copy, every Diff, reasons and the checked list", () => {
  const html = render({ ...base, matching: [{ field: "payer", signed: landingBundle.mandate.payer, proposed: landingBundle.mandate.payer }] });
  expect(html).toContain("RETURNED");
  expect(html).toContain("PAYEE_MISMATCH"); expect(html).toContain("AMOUNT_MISMATCH");
  expect(html).toContain("payee"); expect(html).toContain("amount");
  expect(html).toContain("Checked"); expect(html).toContain("payer · matches");
  expect(html).toContain("aria-label=\"Mandate and Spend Proposal\"");
  expect(html).toContain("--paper-tilt:-1.2deg"); expect(html).toContain("--paper-tilt:2.5deg");
  expect(html).toContain("Copy Receipt digest"); expect(html).toContain("Ledger index");
});

test("REFUSE rings each changed field, including asset, network and additional proposal fields", () => {
  const html = render({ ...base, diff: [
    ...base.diff,
    { field: "asset", signed: "tADA", proposed: "tUSDM" },
    { field: "network", signed: "cardano:preprod", proposed: "cardano:preview" },
    { field: "scheme", signed: "exact", proposed: "other" },
    { field: "deadline", signed: "100", proposed: "200" },
  ] });
  expect(html).toContain("tUSDM"); expect(html).toContain("cardano:preview");
  expect(html).toContain("scheme"); expect(html).toContain("deadline");
  expect((html.match(/pencil-ring/g) ?? []).length).toBeGreaterThanOrEqual(6);
  const assetOnly = render({ ...base, diff: [{ field: "asset", signed: "tADA", proposed: "tUSDM" }] });
  expect(assetOnly).toContain("tUSDM"); expect(assetOnly).toContain("<dt>asset</dt>");
  expect(assetOnly).toContain("ring-target");
});

test("APPROVE shows CLEARED and reports a paid settlement only when settled", () => {
  const proposal = { ...landingProposal, requirements: { ...landingProposal.requirements,
    payTo: landingBundle.mandate.payee, amount: landingBundle.mandate.amount } };
  const html = render({ ...base, verdict: "APPROVE", reasons: [], diff: [], matching: [
    { field: "amount", signed: landingBundle.mandate.amount, proposed: landingBundle.mandate.amount },
  ], proposal, anchor: { kind: "paid", settled: true, onChainState: "ResultSubmitted", txHash: "c".repeat(64) } });
  expect(html).toContain("CLEARED"); expect(html).toContain("PAID — CLEARED · settled");
  expect(html).toContain(`https://preprod.cardanoscan.io/transaction/${"c".repeat(64)}`);
  expect(html.match(/View on Cardanoscan \(preprod\)/g)).toHaveLength(1);
  expect(html.match(/aria-label="Copy Transaction ID"/g)).toHaveLength(1);
  const slipStart = html.indexOf('aria-label="Guard Check slip"');
  const ledgerStart = html.indexOf('aria-label="Ledger index card"');
  expect(slipStart).toBeGreaterThanOrEqual(0);
  expect(html.slice(slipStart, ledgerStart)).toContain("View on Cardanoscan (preprod)");
  expect(html.slice(ledgerStart)).not.toContain("View on Cardanoscan (preprod)");
  expect(html).not.toContain("RETURNED"); expect(html).not.toContain("VOID");
  const unsettled = render({ ...base, verdict: "APPROVE", reasons: [], diff: [], proposal,
    anchor: { kind: "paid", settled: false, onChainState: "FundsLocked", txHash: null } });
  expect(unsettled).toContain("CLEARED — not settled"); expect(unsettled).not.toContain("PAID — CLEARED");
});

test("VOID uses an ink mark and suppresses verdict stamps and settlement claims", () => {
  const html = render({ ...base, receiptValid: false, invalidReasons: ["DIGEST_MISMATCH"],
    anchor: { kind: "paid", settled: true, onChainState: "Settled", txHash: "d".repeat(64) } });
  expect(html).toContain("VOID — not a valid Guard Receipt for this Task");
  expect(html).toContain("DIGEST_MISMATCH"); expect(html).toContain("Settlement is not asserted for a VOID receipt.");
  expect(html).not.toContain("CLEARED"); expect(html).not.toContain("RETURNED"); expect(html).not.toContain(">Settled");
});

test("mandate starts as an editable cheque with a blank stub and teller note", () => {
  const html = renderToStaticMarkup(createElement(MandatePage));
  expect(html).toContain("Teller’s note"); expect(html).toContain("Cheque-book stub");
  expect(html).toContain('id="payee"'); expect(html).toContain('id="amount"');
  expect(html).not.toContain("stub-signed"); expect(html).not.toContain('aria-label="SIGNED on cheque stub"');
});

test("pencil ring geometry follows the local value box and stays inside its padded envelope", () => {
  const localValue = { left: 14, top: 14, width: 120, height: 36 };
  const geometry = fitPencilRing(localValue, { left: 0, top: 0, width: 148, height: 64 });
  expect(geometry).toMatchObject({ left: 0, top: 0, width: 148, height: 64 });
  // The caller supplies offset metrics, not transformed viewport rectangles, so
  // paper tilt/scale cannot change the ring's local CSS geometry.
  const coordinates = geometry.path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  expect(coordinates.length).toBeGreaterThan(10);
  for (let index = 0; index < coordinates.length; index += 2) {
    expect(coordinates[index]).toBeGreaterThanOrEqual(0);
    expect(coordinates[index]).toBeLessThanOrEqual(geometry.width);
    expect(coordinates[index + 1]).toBeGreaterThanOrEqual(0);
    expect(coordinates[index + 1]).toBeLessThanOrEqual(geometry.height);
  }
  expect(roundedRingPath(geometry.width, geometry.height)).toBe(geometry.path);
});

test("Checked amount keeps its human and atomic values in one value cell", () => {
  const html = render({ ...base, matching: [{
    field: "amount", signed: landingBundle.mandate.amount, proposed: landingBundle.mandate.amount,
  }] });
  expect(html).toMatch(/<span class="[^"]*checkedValue[^"]*"><span class="value">2 tADA<\/span><small class="value [^"]*atomic[^"]*">2,000,000 lovelace<\/small><\/span>/);
});
