import { expect, test } from "vitest";
import * as guard from "./index";
import fixture from "./fixtures/mandate.valid.json";

test("parses a Mandate through the public API", () => {
  expect(guard.parseMandate(fixture)).toEqual(fixture);
  expect(guard.MandateSchema.safeParse(fixture).success).toBe(true);
});

test("accepts a valid Cardano bech32 payer longer than 90 characters", () => {
  // Fixed vector computed independently with Python BIP-173 polymod.
  const payer = `addr_test1${"q".repeat(92)}0uk53y`;
  expect(guard.parseMandate({ ...fixture, payer }).payer).toBe(payer);
});

test.each([
  ["wrong version", { v: 2 }],
  ["mainnet payer", { payer: "addr1vqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq" }],
  ["empty payer payload", { payer: "addr_test1" }],
  ["changed payer checksum", { payer: `${fixture.payer.slice(0, -1)}q` }],
  ["short payer checksum", { payer: "addr_test1q" }],
  ["mixed-case payer", { payer: `Addr${fixture.payer.slice(4)}` }],
  ["uppercase payer", { payer: fixture.payer.toUpperCase() }],
  ["invalid payer alphabet", { payer: "addr_test1invalid!" }],
  ["mainnet network", { network: "cardano:mainnet" }],
  ["empty payee", { payee: "" }],
  ["zero amount", { amount: "0" }],
  ["fractional amount", { amount: "1.5" }],
  ["numeric amount", { amount: 2000000 }],
  ["negative amount", { amount: "-1" }],
  ["leading zero", { amount: "01" }],
  ["bad asset", { asset: "ADA" }],
  ["short policy", { asset: "ab.00" }],
  ["non-hex asset name", { asset: `${"a".repeat(56)}.zz` }],
  ["long asset name", { asset: `${"a".repeat(56)}.${"a".repeat(65)}` }],
  ["fractional expiry", { expiry: 1.5 }],
  ["string expiry", { expiry: "1791331200" }],
  ["short nonce", { nonce: "ab" }],
  ["non-hex nonce", { nonce: "g".repeat(32) }],
  ["empty purpose", { purpose: "" }],
  ["long purpose", { purpose: "a".repeat(281) }],
  ["extra key", { extra: true }],
])("rejects %s with a typed error", (_name, changes) => {
  expect(() => guard.parseMandate({ ...fixture, ...changes })).toThrow(guard.MandateParseError);
});

test.each([null, undefined, [], {}, { ...fixture, nonce: undefined }])(
  "rejects missing Mandate data: %j",
  (input) => {
    expect(() => guard.parseMandate(input)).toThrow(guard.MandateParseError);
  },
);

test.each([`${"a".repeat(56)}.`, `${"A".repeat(56)}.${"f".repeat(64)}`])(
  "accepts token asset boundary %s",
  (asset) => {
    const input = { ...fixture, asset, amount: "9007199254740993", purpose: "a".repeat(280) };
    expect(guard.parseMandate(input)).toEqual(input);
  },
);

test("accepts an address payee without changing signed fields", () => {
  const input = { ...fixture, payee: fixture.payer, nonce: fixture.nonce.toUpperCase() };
  expect(guard.parseMandate(input)).toEqual(input);
});

test("canonicalizes nested object keys without reordering arrays", () => {
  const first = { z: [3, 1], a: { y: 2, x: "é" } };
  const second = { a: { x: "é", y: 2 }, z: [3, 1] };
  expect(guard.jcs(first)).toBe('{"a":{"x":"é","y":2},"z":[3,1]}');
  expect(guard.jcs(second)).toBe(guard.jcs(first));
});

test.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])(
  "does not return an invalid canonical JSON string for %s",
  (input) => {
    expect(() => guard.jcs(input)).toThrow();
  },
);

test("matches the fixed Mandate Digest vector regardless of key order", () => {
  // Independently computed with Python hashlib over sorted compact JSON of this ASCII fixture.
  const expected = "f5031d695faddf6034a425a6a8f047db909f2db43232c3fb4a976ae483f10cf4";
  const mandate = guard.parseMandate(fixture);
  expect(guard.mandateDigest(mandate)).toBe(expected);
  const reordered = Object.fromEntries(Object.entries(mandate).reverse());
  expect(guard.mandateDigest(guard.parseMandate(reordered))).toBe(expected);
  expect(guard.mandateDigest({ ...mandate, amount: "2000001" })).not.toBe(expected);
});
