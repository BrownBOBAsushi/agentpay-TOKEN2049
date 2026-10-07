import { readFileSync } from "node:fs";
import { Address, CBOR, COSE, KeyHash, PrivateKey } from "@evolution-sdk/evolution";
import { expect, it } from "vitest";
import * as guard from "./index";
import fixture from "./fixtures/bundle.valid.json";

function changeKey(label: bigint, value: CBOR.CBOR) {
  const key = CBOR.fromCBORHex(fixture.coseKey);
  if (!(key instanceof Map)) throw new Error("Test fixture key must be a map");
  key.set(label, value);
  return { ...fixture, coseKey: CBOR.toCBORHex(key) };
}

function withHashedFlag(value: CBOR.CBOR) {
  const sign1 = CBOR.fromCBORHex(fixture.coseSign1);
  if (!Array.isArray(sign1) || !(sign1[1] instanceof Map)) {
    throw new Error("Test fixture must have COSE_Sign1 headers");
  }
  sign1[1].set("hashed", value);
  return { ...fixture, coseSign1: CBOR.toCBORHex(sign1) };
}

it("verifies the saved bundle without signing at verification time", () => {
  expect(guard.verifyMandate(fixture)).toEqual({ ok: true });
});

it("reproduces the saved signature with a deterministic test-only key", () => {
  // TEST ONLY: public synthetic seed. Never use this key for a wallet or funds.
  const testKey = PrivateKey.fromBytes(new Uint8Array(32).fill(1));
  const addressHex = `60${KeyHash.toHex(KeyHash.fromPrivateKey(testKey))}`;
  expect(Address.toBech32(Address.fromHex(addressHex))).toBe(fixture.payerAddress);
  const signed = COSE.SignData.signData(addressHex, Buffer.from(guard.jcs(fixture.mandate), "utf8"), testKey);
  expect(Buffer.from(signed.signature).toString("hex")).toBe(fixture.coseSign1);
  expect(Buffer.from(signed.key).toString("hex")).toBe(fixture.coseKey);
});

it("rejects a changed amount before signature verification", () => {
  const mandate = { ...fixture.mandate, amount: "2000001" };
  expect(guard.verifyMandate({ ...fixture, mandate })).toEqual({ ok: false, reason: "DIGEST_MISMATCH" });
});

it("rejects a changed amount even with a recomputed digest", () => {
  const mandate = guard.parseMandate({ ...fixture.mandate, amount: "2000001" });
  expect(guard.verifyMandate({ ...fixture, mandate, digest: guard.mandateDigest(mandate) }))
    .toEqual({ ok: false, reason: "SIG_INVALID" });
});

it("rejects a different payerAddress", () => {
  const payerAddress = Address.toBech32(Address.fromHex(`60${"00".repeat(28)}`));
  expect(guard.verifyMandate({ ...fixture, payerAddress })).toEqual({ ok: false, reason: "SIGNER_MISMATCH" });
});

it("rejects a script payment credential", () => {
  const payerAddress = Address.toBech32(Address.fromHex(`70${"00".repeat(28)}`));
  const mandate = guard.parseMandate({ ...fixture.mandate, payer: payerAddress });
  expect(guard.verifyMandate({ ...fixture, mandate, payerAddress, digest: guard.mandateDigest(mandate) }))
    .toEqual({ ok: false, reason: "SIGNER_MISMATCH" });
});

it("binds the signature to the payment credential even when both payer fields change", () => {
  const payerAddress = Address.toBech32(Address.fromHex(`60${"00".repeat(28)}`));
  const mandate = guard.parseMandate({ ...fixture.mandate, payer: payerAddress });
  expect(guard.verifyMandate({ ...fixture, mandate, payerAddress, digest: guard.mandateDigest(mandate) }))
    .toEqual({ ok: false, reason: "SIG_INVALID" });
});

it("rejects a flipped signature byte", () => {
  const bytes = Buffer.from(fixture.coseSign1, "hex");
  bytes[bytes.length - 1] ^= 1;
  expect(guard.verifyMandate({ ...fixture, coseSign1: bytes.toString("hex") }))
    .toEqual({ ok: false, reason: "SIG_INVALID" });
});

it.each([true, "false", 0n])("rejects unsupported hashed flag %s", (flag) => {
  expect(guard.verifyMandate(withHashedFlag(flag))).toEqual({ ok: false, reason: "SIG_INVALID" });
});

it.each([
  ["wrong key type", 1n, 2n],
  ["wrong algorithm", 3n, -7n],
  ["wrong curve", -1n, 5n],
  ["short public key", -2n, new Uint8Array(31)],
  ["private key parameter", -4n, new Uint8Array(32)],
] as const)("rejects COSE_Key with %s", (_name, label, value) => {
  expect(guard.verifyMandate(changeKey(label, value))).toEqual({ ok: false, reason: "SIG_INVALID" });
});

it.each(["coseSign1", "coseKey", "digest"] as const)("rejects junk hex in %s", (field) => {
  expect(guard.verifyMandate({ ...fixture, [field]: "not-hex" })).toEqual({ ok: false, reason: "BUNDLE_INVALID" });
});

it.each(["0", "", "aa\r\n"])("rejects malformed hex %j", (coseSign1) => {
  expect(guard.verifyMandate({ ...fixture, coseSign1 })).toEqual({ ok: false, reason: "BUNDLE_INVALID" });
});

it.each([null, undefined, {}, [], { ...fixture, extra: true }])("returns BUNDLE_INVALID for malformed bundle %j", (bundle) => {
  expect(guard.verifyMandate(bundle)).toEqual({ ok: false, reason: "BUNDLE_INVALID" });
});

it.each(["coseSign1", "coseKey"] as const)("does not throw on malformed CBOR in %s", (field) => {
  expect(guard.verifyMandate({ ...fixture, [field]: "ff" })).toEqual({ ok: false, reason: "SIG_INVALID" });
});

it("verifies a Lace/Eternl signData bundle", () => {
  // Real Lace (preprod) signData bundle, signed by the user on /mandate (SPIKE S3, 2026-10-07).
  const bundle = JSON.parse(readFileSync(new URL("./fixtures/bundle.wallet.json", import.meta.url), "utf8"));
  expect(guard.verifyMandate(bundle)).toEqual({ ok: true });
});
