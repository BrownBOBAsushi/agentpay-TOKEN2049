import { Address, CBOR, KeyHash, PrivateKey } from "@evolution-sdk/evolution";
import { expect, test } from "vitest";
import * as guard from "./index";

// TEST ONLY: fixed public seed. Never use this key for a wallet or funds.
const privateKeyHex = "02".repeat(32);
const address = Address.toBech32(Address.fromHex(`60${KeyHash.toHex(KeyHash.fromPrivateKey(PrivateKey.fromHex(privateKeyHex)))}`));
const testGuardKey = { privateKeyHex, address };
const receipt: guard.GuardReceipt = {
  v: 1,
  verdict: "REFUSE",
  reasons: ["PAYEE_MISMATCH", "AMOUNT_MISMATCH"],
  diff: [
    { field: "payee", signed: "demo-agent", proposed: "attacker-agent" },
    { field: "amount", signed: "2000000", proposed: "9000000" },
  ],
  mandateDigest: "0".repeat(64),
  proposalDigest: "1".repeat(64),
  taskId: "test-task-005",
  ts: 1791330000,
};

test.each(["APPROVE", "REFUSE"] as const)("signs and verifies a %s Guard Receipt", (verdict) => {
  const input = verdict === "APPROVE" ? { ...receipt, verdict, reasons: [], diff: [] } : receipt;
  const signed = guard.signReceipt(input, testGuardKey);
  expect(signed.receipt).toEqual(input);
  expect(signed.guardAddress).toBe(address);
  expect(signed.digest).toBe(guard.receiptDigest(input));
  expect(guard.verifyReceipt(signed, address)).toBe(true);
});

test("matches the pinned receipt digest independent of object key order", () => {
  // Computed independently with Python hashlib over sorted compact ASCII JSON.
  const expected = "1c844468895e13eb745f3f7168ffcb65ac69ddabba07fa8d7cc10e017023b95e";
  expect(guard.receiptDigest(receipt)).toBe(expected);
  const reordered = Object.fromEntries(Object.entries(receipt).reverse()) as guard.GuardReceipt;
  expect(guard.receiptDigest(reordered)).toBe(expected);
});

test("uses the proposal digest domain prefix", () => {
  const proposal: guard.SpendProposal = {
    kind: "x402",
    requirements: { scheme: "exact", network: "cardano:preprod", amount: "2000000", asset: "lovelace", payTo: "demo-agent", maxTimeoutSeconds: 600 },
  };
  // Independent Python hashlib vector.
  expect(guard.proposalDigest(proposal)).toBe("55aeda4515fcd22f4ddd33dd96120c73054a2b366654d1678a2feba6523766a5");
});

test.each([
  ["verdict", { verdict: "APPROVE" as const }],
  ["Diff", { diff: [{ field: "amount", signed: "2000000", proposed: "1" }] }],
  ["task", { taskId: "other-task" }],
  ["timestamp", { ts: 1791330001 }],
])("rejects changed %s even with a recomputed digest", (_name, changes) => {
  const signed = guard.signReceipt(receipt, testGuardKey);
  const changed = { ...receipt, ...changes };
  expect(guard.verifyReceipt({ ...signed, receipt: changed }, address)).toBe(false);
  expect(guard.verifyReceipt({ ...signed, receipt: changed, digest: guard.receiptDigest(changed) }, address)).toBe(false);
});

test("rejects a different expected Guard address", () => {
  const signed = guard.signReceipt(receipt, testGuardKey);
  const other = Address.toBech32(Address.fromHex(`60${"00".repeat(28)}`));
  expect(guard.verifyReceipt(signed, other)).toBe(false);
  expect(guard.verifyReceipt({ ...signed, guardAddress: other }, other)).toBe(false);
});

test("refuses to sign for an address that does not belong to the key", () => {
  const other = Address.toBech32(Address.fromHex(`60${"00".repeat(28)}`));
  expect(() => guard.signReceipt(receipt, { ...testGuardKey, address: other })).toThrow();
});

test("rejects a flipped signature byte", () => {
  const signed = guard.signReceipt(receipt, testGuardKey);
  const bytes = Buffer.from(signed.coseSign1, "hex");
  bytes[bytes.length - 1] ^= 1;
  expect(guard.verifyReceipt({ ...signed, coseSign1: bytes.toString("hex") }, address)).toBe(false);
});

test.each([
  ["wrong key type", 1n, 2n], ["wrong algorithm", 3n, -7n], ["wrong curve", -1n, 5n],
  ["short public key", -2n, new Uint8Array(31)], ["private parameter", -4n, new Uint8Array(32)],
] as const)("rejects COSE_Key with %s", (_name, label, value) => {
  const signed = guard.signReceipt(receipt, testGuardKey);
  const key = CBOR.fromCBORHex(signed.coseKey);
  if (!(key instanceof Map)) throw new Error("Test key must be a map");
  key.set(label, value);
  expect(guard.verifyReceipt({ ...signed, coseKey: CBOR.toCBORHex(key) }, address)).toBe(false);
});

test("rejects hashed:true receipts", () => {
  const signed = guard.signReceipt(receipt, testGuardKey);
  const sign1 = CBOR.fromCBORHex(signed.coseSign1);
  if (!Array.isArray(sign1) || !(sign1[1] instanceof Map)) throw new Error("Test signature must have headers");
  sign1[1].set("hashed", true);
  expect(guard.verifyReceipt({ ...signed, coseSign1: CBOR.toCBORHex(sign1) }, address)).toBe(false);
});

test.each([null, undefined, {}, { receipt }])("returns false for malformed signed receipt %#", (invalid) => {
  expect(guard.verifyReceipt(invalid, address)).toBe(false);
});

test.each(["coseSign1", "coseKey", "digest"] as const)("returns false for junk hex in %s", (field) => {
  const signed = guard.signReceipt(receipt, testGuardKey);
  expect(guard.verifyReceipt({ ...signed, [field]: "not-hex" }, address)).toBe(false);
});
