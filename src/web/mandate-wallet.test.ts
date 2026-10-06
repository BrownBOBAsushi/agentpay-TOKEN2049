import { Address, CBOR, COSE, PrivateKey } from "@evolution-sdk/evolution";
import { afterEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fixture from "../guard/fixtures/bundle.valid.json";
import { verifyMandate } from "../guard/cip8";
import { mandateDigest } from "../guard/digest";
import { jcs } from "../guard/jcs";
import { parseMandate } from "../guard/mandate";
import { atomicToDecimal, decimalToAtomic } from "./amount";
import { connectWallet, installedWallets, signMandate, expiryUtc, newNonce, validateDraft,
  NO_WALLET, WRONG_NETWORK, CANCELLED, type WalletApi, type WalletWindow, type Draft } from "./mandate-wallet";
import MandatePage from "../../app/mandate/page";
import { Stamp } from "./Stamp";

afterEach(() => vi.unstubAllGlobals());
const mandate = parseMandate(fixture.mandate);
const addressHex = Address.toHex(Address.fromBech32(fixture.payerAddress));
const draft: Draft = { payee: mandate.payee, amount: atomicToDecimal(mandate.amount), asset: "tADA",
  purpose: mandate.purpose, expiry: new Date(mandate.expiry * 1000).toISOString().slice(0, 16), nonce: mandate.nonce };
function fakeWallet(changes: Partial<WalletApi> = {}) {
  // T-003 TEST ONLY: public synthetic key. Never used for funds or included in page code.
  const testKey = PrivateKey.fromBytes(new Uint8Array(32).fill(1));
  const api: WalletApi = {
    getNetworkId: vi.fn().mockResolvedValue(0), getUsedAddresses: vi.fn().mockResolvedValue([addressHex]),
    getChangeAddress: vi.fn().mockResolvedValue(addressHex),
    signData: vi.fn(async (address, payload) => {
      const signature = COSE.SignData.signData(address, Buffer.from(payload, "hex"), testKey);
      return { signature: Buffer.from(signature.signature).toString("hex"), key: Buffer.from(signature.key).toString("hex") };
    }), ...changes,
  };
  const enable = vi.fn().mockResolvedValue(api);
  vi.stubGlobal("window", { cardano: { lace: { enable } } });
  return { api, enable, source: window as WalletWindow };
}

test.each([["2", "2000000"], ["0.000001", "1"], ["1.234567", "1234567"], ["0002.000000", "2000000"],
  ["9007199254740993.123456", "9007199254740993123456"]])("converts %s without floats", (input, output) => {
  expect(decimalToAtomic(input)).toBe(output);
});
test.each(["1.0000001", "0", "-2", "1e6", "Infinity", "", " 2", "2."])("rejects amount %s", (input) => {
  expect(() => decimalToAtomic(input)).toThrow();
});
test("UTC expiry does not use the host timezone and rejects normalized dates", () => {
  expect(expiryUtc("2026-10-07T12:34")).toBe(Date.UTC(2026, 9, 7, 12, 34) / 1000);
  expect(expiryUtc("2028-02-29T00:00")).toBe(Date.UTC(2028, 1, 29) / 1000);
  for (const value of ["2026-02-29T00:00", "2026-10-07T24:00", "2026-10-07", "2026-10-07T12:34Z"]) expect(() => expiryUtc(value)).toThrow();
});
test("nonce uses 16 bytes from Web Crypto", () => {
  const getRandomValues = vi.spyOn(crypto, "getRandomValues");
  const first = newNonce(); const second = newNonce();
  expect(first).toMatch(/^[0-9a-f]{32}$/); expect(second).not.toBe(first);
  expect(getRandomValues.mock.calls[0][0]).toHaveLength(16); getRandomValues.mockRestore();
});
test("live validation uses Mandate schema and rejects unconfigured tUSDM", () => {
  expect(validateDraft(draft, mandate.payer).mandate).toEqual(mandate);
  const unit = `${"a".repeat(56)}.5553444d`;
  expect(validateDraft({ ...draft, asset: "tUSDM" }, mandate.payer, unit).mandate?.asset).toBe(unit);
  for (const configured of [undefined, "lovelace", "bad-unit"]) expect(validateDraft({ ...draft, asset: "tUSDM" }, mandate.payer, configured).errors.asset).toBeTruthy();
  const errors = validateDraft({ ...draft, payee: "", purpose: "", amount: "0", expiry: "", nonce: "bad" }, "").errors;
  for (const field of ["payee", "purpose", "amount", "expiry", "nonce", "payer"] as const) expect(errors[field]).toBeTruthy();
});
test("fake window.cardano discovers only supported installed providers", async () => {
  vi.stubGlobal("window", {});
  expect(installedWallets(window as WalletWindow)).toEqual([]);
  await expect(connectWallet(window as WalletWindow, "lace")).rejects.toThrow(NO_WALLET);
  vi.stubGlobal("window", { cardano: { eternl: { enable() {} }, other: { enable() {} } } });
  expect(installedWallets(window as WalletWindow)).toEqual(["eternl"]);
});
test("wrong network is refused before requesting addresses or a signature", async () => {
  const { api, source } = fakeWallet({ getNetworkId: vi.fn().mockResolvedValue(1) });
  await expect(connectWallet(source, "lace")).rejects.toThrow(WRONG_NETWORK);
  expect(api.getUsedAddresses).not.toHaveBeenCalled(); expect(api.signData).not.toHaveBeenCalled();
});
test("empty used addresses fall back to change address", async () => {
  const { api, source } = fakeWallet({ getUsedAddresses: vi.fn().mockResolvedValue([]) });
  expect((await connectWallet(source, "lace")).payer).toBe(mandate.payer);
  expect(api.getChangeAddress).toHaveBeenCalledOnce();
});
test.each([`70${"00".repeat(28)}`, `e0${"00".repeat(28)}`, `61${"00".repeat(28)}`])("refuses non-testnet payment key address %s", async (address) => {
  const { source } = fakeWallet({ getUsedAddresses: vi.fn().mockResolvedValue([address]) });
  await expect(connectWallet(source, "lace")).rejects.toThrow("key-hash payment credential");
});
test("signData receives raw UTF-8 JCS and reproduces the T-003 bundle", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const { api, source } = fakeWallet();
  const wallet = await connectWallet(source, "lace");
  const bundle = await signMandate(wallet, mandate);
  expect(api.signData).toHaveBeenCalledWith(addressHex, Buffer.from(jcs(mandate), "utf8").toString("hex"));
  expect(bundle).toEqual(fixture); expect(verifyMandate(bundle)).toEqual({ ok: true });
  expect(bundle.digest).toBe(mandateDigest(mandate)); expect(fetcher).not.toHaveBeenCalled();
});
test("hashed:true wallet result has a fixed SIG_INVALID explanation", async () => {
  const sign1 = CBOR.fromCBORHex(fixture.coseSign1) as CBOR.CBOR[];
  (sign1[1] as Map<CBOR.CBOR, CBOR.CBOR>).set("hashed", true);
  const { source } = fakeWallet({ signData: vi.fn().mockResolvedValue({ signature: CBOR.toCBORHex(sign1), key: fixture.coseKey }) });
  await expect(signMandate(await connectWallet(source, "lace"), mandate)).rejects.toThrow("SIG_INVALID: This wallet signed a hashed payload; AgentPay Guard needs the raw payload.");
});
test("wallet rejection and closed popup report cancellation without changing input", async () => {
  const { enable, source } = fakeWallet(); enable.mockRejectedValueOnce(new Error("private wallet response"));
  await expect(connectWallet(source, "lace")).rejects.toThrow(CANCELLED);
  const other = fakeWallet({ signData: vi.fn().mockRejectedValue({ code: 2, info: "private response" }) });
  const before = JSON.stringify(mandate);
  await expect(signMandate(await connectWallet(other.source, "lace"), mandate)).rejects.toThrow(CANCELLED);
  expect(JSON.stringify(mandate)).toBe(before);
});
test("network is checked again at signing time", async () => {
  const { api, source } = fakeWallet(); const wallet = await connectWallet(source, "lace");
  vi.mocked(api.getNetworkId).mockResolvedValue(1);
  await expect(signMandate(wallet, mandate)).rejects.toThrow(WRONG_NETWORK); expect(api.signData).not.toHaveBeenCalled();
});
test("Unicode memo is encoded as UTF-8 and still verifies", async () => {
  const { api, source } = fakeWallet();
  const input = { ...mandate, purpose: "Market data — café 東京" };
  const bundle = await signMandate(await connectWallet(source, "lace"), input);
  expect(api.signData).toHaveBeenCalledWith(addressHex, Buffer.from(jcs(input), "utf8").toString("hex"));
  expect(verifyMandate(bundle)).toEqual({ ok: true });
});
test("tampered wallet signature cannot produce a signed bundle", async () => {
  const signature = `${fixture.coseSign1.slice(0, -2)}00`;
  const { source } = fakeWallet({ signData: vi.fn().mockResolvedValue({ signature, key: fixture.coseKey }) });
  await expect(signMandate(await connectWallet(source, "lace"), mandate)).rejects.toThrow("SIG_INVALID");
});
test("form has labelled standard controls and no success mark before verification", () => {
  const html = renderToStaticMarkup(createElement(MandatePage));
  for (const id of ["payee", "amount", "asset", "purpose", "expiry", "nonce"]) {
    expect(html).toContain(`for="${id}"`); expect(html).toContain(`id="${id}"`);
  }
  expect(html).toContain('type="datetime-local"'); expect(html).toContain('type="number"');
  expect(html).not.toContain('aria-label="SIGNED"'); expect(html).not.toContain("Copy bundle");
  const mark = renderToStaticMarkup(createElement(Stamp, { variant: "signed" }));
  expect(mark).toContain('aria-label="SIGNED"'); expect(mark).toContain("<circle"); expect(mark).not.toContain("<animate");
});
