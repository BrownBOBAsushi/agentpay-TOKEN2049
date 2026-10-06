import { expect, test } from "vitest";
import * as guard from "./index";
import bundle from "./fixtures/bundle.valid.json";

const nowSec = bundle.mandate.expiry - 600;
const requirements = {
  scheme: "exact",
  network: "cardano:preprod",
  amount: "2000000",
  asset: "lovelace",
  payTo: "demo-agent",
  maxTimeoutSeconds: 600,
  extra: { assetTransferMethod: "default", areFeesSponsored: false },
};
const proposal = { kind: "x402", requirements };

test("S1 approves an exact proposal with its deadline at expiry", () => {
  expect(guard.guardCheck({ bundle, proposal }, { nowSec, nonceUsed: false }))
    .toEqual({ verdict: "APPROVE", reasons: [], diff: [] });
});

test("S2 reports both the injected payee and amount", () => {
  const injected = { ...proposal, requirements: { ...requirements, payTo: "attacker-agent", amount: "9000000" } };
  expect(guard.guardCheck({ bundle, proposal: injected }, { nowSec, nonceUsed: false })).toEqual({
    verdict: "REFUSE",
    reasons: ["PAYEE_MISMATCH", "AMOUNT_MISMATCH"],
    diff: [
      { field: "payee", signed: "demo-agent", proposed: "attacker-agent" },
      { field: "amount", signed: "2000000", proposed: "9000000" },
    ],
  });
});

test.each([0, 1])("refuses an expired Mandate at expiry + %s before nonce or proposal checks", (offset) => {
  expect(guard.guardCheck({ bundle, proposal: null }, { nowSec: bundle.mandate.expiry + offset, nonceUsed: true }))
    .toEqual({ verdict: "REFUSE", reasons: ["MANDATE_EXPIRED"], diff: [] });
});

test("refuses a reused nonce before parsing the proposal", () => {
  expect(guard.guardCheck({ bundle, proposal: null }, { nowSec, nonceUsed: true }))
    .toEqual({ verdict: "REFUSE", reasons: ["NONCE_REUSED"], diff: [] });
});

test.each([
  ["network", "cardano:mainnet", "NETWORK_MISMATCH", "network", "cardano:preprod", "cardano:mainnet"],
  ["scheme", "upto", "SCHEME_MISMATCH", "scheme", "exact", "upto"],
  ["asset", `${"a".repeat(56)}.00`, "ASSET_MISMATCH", "asset", "lovelace", `${"a".repeat(56)}.00`],
  ["amount", "1999999", "AMOUNT_MISMATCH", "amount", "2000000", "1999999"],
  ["maxTimeoutSeconds", 601, "DEADLINE_AFTER_EXPIRY", "deadline", String(bundle.mandate.expiry), String(bundle.mandate.expiry + 1)],
] as const)("reports the %s mismatch with signed and proposed values", (key, value, reason, field, signed, proposed) => {
  const changed = { ...proposal, requirements: { ...requirements, [key]: value } };
  expect(guard.guardCheck({ bundle, proposal: changed }, { nowSec, nonceUsed: false }))
    .toEqual({ verdict: "REFUSE", reasons: [reason], diff: [{ field, signed, proposed }] });
});

test("collects all six matcher mismatches in stable field order", () => {
  const changed = { ...requirements, scheme: "upto", network: "cardano:mainnet", payTo: "other", asset: `${"a".repeat(56)}.`, amount: "1", maxTimeoutSeconds: 601 };
  const result = guard.matchX402(guard.parseMandate(bundle.mandate), changed, nowSec);
  expect(result.reasons).toEqual([
    "NETWORK_MISMATCH", "SCHEME_MISMATCH", "PAYEE_MISMATCH", "ASSET_MISMATCH", "AMOUNT_MISMATCH", "DEADLINE_AFTER_EXPIRY",
  ]);
  expect(result.diff.map((entry) => entry.field)).toEqual(["network", "scheme", "payee", "asset", "amount", "deadline"]);
});

test("checks the signature before time, nonce, or proposal access", () => {
  const signature = Buffer.from(bundle.coseSign1, "hex");
  signature[signature.length - 1] ^= 1;
  const invalid = { ...bundle, coseSign1: signature.toString("hex") };
  const unreadableProposal = { get requirements() { throw new Error("Proposal must not be read"); } };
  expect(guard.guardCheck({ bundle: invalid, proposal: unreadableProposal }, { nowSec: bundle.mandate.expiry, nonceUsed: true }))
    .toEqual({ verdict: "REFUSE", reasons: ["SIG_INVALID"], diff: [] });
});

test("preserves digest verification failures", () => {
  const changed = { ...bundle, mandate: { ...bundle.mandate, amount: "1" } };
  expect(guard.guardCheck({ bundle: changed, proposal }, { nowSec, nonceUsed: false }))
    .toEqual({ verdict: "REFUSE", reasons: ["DIGEST_MISMATCH"], diff: [] });
});

test.each([
  null,
  {},
  { kind: "cardano-tx", requirements },
  { kind: "x402", requirements: {} },
  ...[
    { amount: 2000000 }, { amount: "0" }, { amount: "1.5" },
    { amount: "02000000" }, { amount: "2000000\n" },
    { maxTimeoutSeconds: -1 }, { maxTimeoutSeconds: 1.5 }, { maxTimeoutSeconds: "600" },
    { payTo: "" }, { asset: "invalid" }, { network: "" }, { scheme: "" }, { extra: [] },
  ].map((change) => ({ kind: "x402", requirements: { ...requirements, ...change } })),
])("rejects malformed proposal %#", (invalid) => {
  expect(guard.guardCheck({ bundle, proposal: invalid }, { nowSec, nonceUsed: false }))
    .toEqual({ verdict: "REFUSE", reasons: ["PROPOSAL_INVALID"], diff: [] });
});

test("accepts a shorter deadline and an offer without extra metadata", () => {
  const minimal = { ...requirements, maxTimeoutSeconds: 1, extra: undefined };
  expect(guard.guardCheck({ bundle, proposal: { kind: "x402", requirements: minimal } }, { nowSec, nonceUsed: false }))
    .toEqual({ verdict: "APPROVE", reasons: [], diff: [] });
});
