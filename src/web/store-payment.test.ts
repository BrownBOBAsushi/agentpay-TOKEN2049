import { mkdir, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Address, CBOR, COSE, KeyHash, PrivateKey, SlotConfig, Time, Transaction, TransactionBody, TransactionHash } from "@evolution-sdk/evolution";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { jcs, mandateDigest, proposalDigest, signReceipt, type MandateBundle, type SpendProposal } from "../guard";
import { createDevMandate } from "../orchestrator/mandate";
import { createPaymentRunner } from "../orchestrator/payment";
import { createLatteHandler } from "./store-seller.server";
import { handleStorePay, STORE_JOURNAL_PATH } from "./store-payment.server";
import { hasStoreLiveKey, validateStoreMandate, STORE_PAYEE } from "./store-live.server";
import { POST, maxDuration } from "../../app/api/store/pay/route";
import { GET } from "../../app/api/store/latte/route";

vi.mock("server-only", () => ({}));
// The SDK ESM entry has a bare next/server import that Node cannot resolve.
// Its real CJS build supports this Vitest runner; no x402 behavior is mocked.
vi.mock("@x402/next", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("@x402/next");
});
const env = { NODE_ENV: "test" as const, STORE_LIVE_KEY: "live-test-placeholder-01234567890123456789",
  ORCHESTRATOR_WALLET_MNEMONIC: "mnemonic-test-placeholder", BLOCKFROST_API_KEY_PREPROD: "provider-test-placeholder",
  SOKOSUMI_API_URL: "https://api.preprod.sokosumi.com", SOKOSUMI_COWORKER_API_KEY: "core-test-placeholder" };
const key = PrivateKey.fromHex("03".repeat(32));
const guardAddress = Address.toBech32(Address.fromHex(`60${KeyHash.toHex(KeyHash.fromPrivateKey(key))}`));
const options = { ...env, GUARD_ADDRESS: guardAddress };
const taskId = "store-task";
const endpoint = "https://store.test/api/store/latte";
const journals: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(journals.splice(0).map(async (path) => {
  try { await unlink(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
})); });
const bundle = () => createDevMandate({ payee: STORE_PAYEE, amount: "6500000" });
const proposal: SpendProposal = { kind: "x402", requirements: { scheme: "exact", network: "cardano:preprod", asset: "lovelace",
  amount: "6500000", payTo: STORE_PAYEE, maxTimeoutSeconds: 600, extra: { confirmationPolicy: { l1Confirmations: 0 } } } };
function request(body: unknown = { taskId }, liveKey: string | null = env.STORE_LIVE_KEY) {
  return new Request("https://store.test/api/store/pay", { method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(liveKey === null ? {} : { "x-store-live-key": liveKey }) } });
}
function coreFetch(b: MandateBundle, settings: { verdict?: "APPROVE" | "REFUSE"; digest?: "mandateDigest" | "proposalDigest"; proposal?: SpendProposal;
  signedTaskId?: string; badSignature?: boolean; eventId?: string; status?: string; paginated?: boolean } = {}) {
  const signed = signReceipt({ v: 1, verdict: settings.verdict ?? "APPROVE", reasons: [], diff: [],
    taskId: settings.signedTaskId ?? taskId, ts: Math.floor(Date.now() / 1000), mandateDigest: b.digest,
    proposalDigest: proposalDigest(settings.proposal ?? proposal), ...(settings.digest ? { [settings.digest]: "ab".repeat(32) } : {}) },
  { privateKeyHex: PrivateKey.toHex(key), address: guardAddress });
  if (settings.badSignature) signed.digest = "cd".repeat(32);
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/events")) {
      if (settings.paginated && !url.search) return Response.json({ data: [{ status: "RUNNING" }], meta: { pagination: { nextCursor: "page2" } } });
      return Response.json({ data: [{ id: settings.eventId ?? "event-complete", taskId, status: "COMPLETED", createdAt: "2026-10-07T00:00:00Z", comment: JSON.stringify(signed) }] });
    }
    if (url.pathname.endsWith("/receipt")) return Response.json({ data: null });
    return Response.json({ data: { id: taskId, status: settings.status ?? "COMPLETED", description: JSON.stringify({ mandateBundle: b, proposal: settings.proposal ?? proposal }) } });
  });
}
async function payer(settings: { ttl?: bigint; changed?: boolean; chain?: boolean } = {}) {
  await mkdir(join(process.cwd(), "runs"), { recursive: true });
  const journalPath = join(process.cwd(), "runs", `t022-${randomUUID()}.json`); journals.push(journalPath);
  const body = new Map<CBOR.CBOR, CBOR.CBOR>([[0n, []], [1n, []], [2n, 170000n],
    [3n, settings.ttl ?? Time.unixTimeToSlot(BigInt(Date.now() + 600_000), SlotConfig.getSlotConfig("Preprod"))]]);
  const bytes = CBOR.toCBORBytes([body, new Map(), true, null]);
  const txHash = TransactionHash.toHex(TransactionBody.toHashFromBytes(Transaction.extractBodyBytes(bytes)));
  const required = { x402Version: 2, resource: { url: endpoint }, accepts: [proposal.requirements] };
  const headers = { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader({ x402Version: 2, accepted: { ...proposal.requirements, network: "cardano:preprod", extra: proposal.requirements.extra! },
    payload: { transaction: Buffer.from(bytes).toString("base64"), nonce: `${"ab".repeat(32)}#0` } }) };
  const sign = vi.fn(async () => headers);
  const sent: string[] = [];
  const paymentFetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const signature = new Headers(init?.headers).get("PAYMENT-SIGNATURE");
    if (!signature) return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(settings.changed
      ? { ...required, accepts: [{ ...proposal.requirements, amount: "28000000" }] } : required)).toString("base64") } });
    sent.push(signature);
    return settings.chain ? new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ ...required, error: "nonce_not_on_chain" })).toString("base64") } })
      : new Response("{}", { headers: { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify({ success: true, network: "cardano:preprod", transaction: txHash })).toString("base64") } });
  });
  const pay = createPaymentRunner({ journalPath, deps: { fetch: paymentFetch, createHeaders: sign, sleep: async () => {}, lookupTransaction: async () => true, log: () => {} } });
  return { pay, sign, sent, journalPath, txHash };
}

it("unpaid latte GET returns the exact x402 requirements without network", async () => {
  const handler = createLatteHandler({ getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "cardano:preprod" }], extensions: [], signers: {} }),
    verify: async () => ({ isValid: true }), settle: async () => ({ success: true, transaction: "ab".repeat(32), network: "cardano:preprod" }) });
  const response = await handler(new NextRequest(endpoint));
  expect(response.status).toBe(402);
  const required = JSON.parse(Buffer.from(response.headers.get("PAYMENT-REQUIRED")!, "base64").toString());
  expect(required.accepts).toEqual([proposal.requirements]);
  const paid = await handler(new NextRequest(endpoint, { headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader({ x402Version: 2,
    accepted: { ...proposal.requirements, network: "cardano:preprod", extra: proposal.requirements.extra! }, payload: {} }) } }));
  expect(paid.status).toBe(200); expect(await paid.json()).toEqual({ item: "Latte", store: "The Corner Store" });
});
it("exported latte route returns 402 through the real HTTP facilitator client with offline fetch", async () => {
  vi.stubEnv("X402_FACILITATOR_URL", "");
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    expect(String(input)).toBe("https://x402.preprod.dev.ecosyseng.cf-deployments.org/supported");
    return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: "cardano:preprod" }], extensions: [], signers: {} });
  });
  const response = await GET(new NextRequest(endpoint));
  expect(response.status).toBe(402); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(JSON.parse(Buffer.from(response.headers.get("PAYMENT-REQUIRED")!, "base64").toString()).accepts).toEqual([proposal.requirements]);
});
it.each([null, "wrong", "x".repeat(env.STORE_LIVE_KEY.length), env.STORE_LIVE_KEY + "x"])("rejects live key %s before any receipt or payment operation", async (liveKey) => {
  const fetcher = vi.fn<typeof fetch>(); const pay = vi.fn();
  const response = await handleStorePay(request(undefined, liveKey), { env: options, fetch: fetcher, pay });
  expect(response.status).toBe(403); expect(fetcher).not.toHaveBeenCalled(); expect(pay).not.toHaveBeenCalled();
  expect(await response.text()).not.toContain(env.STORE_LIVE_KEY);
});
it("live key comparison disables short or missing configuration and handles UTF-8 byte lengths", () => {
  expect(hasStoreLiveKey(request(), env)).toBe(true);
  expect(hasStoreLiveKey(request({}, "short"), { NODE_ENV: "test", STORE_LIVE_KEY: "short" })).toBe(false);
  expect(hasStoreLiveKey(request(), { NODE_ENV: "test" })).toBe(false);
  expect(hasStoreLiveKey(request({}, "é".repeat(32)), { NODE_ENV: "test", STORE_LIVE_KEY: "a".repeat(32) })).toBe(false);
});
it("verified APPROVE pays once and a second call returns the saved result without signing", async () => {
  const b = bundle(); const paid = await payer(); const fetcher = coreFetch(b, { paginated: true });
  for (let i = 0; i < 2; i++) {
    const response = await handleStorePay(request(), { env: options, fetch: fetcher, pay: paid.pay });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ txHash: paid.txHash, status: "confirmed" });
  }
  expect(paid.sign).toHaveBeenCalledTimes(1); expect(paid.sent).toHaveLength(1);
  const journal = JSON.parse(await readFile(paid.journalPath, "utf8"));
  expect(journal.actions[JSON.stringify([taskId, "event-complete", "pay"])]).toMatchObject({ state: "done", payment: { txHash: paid.txHash } });
  expect(STORE_JOURNAL_PATH).toBe("/tmp/agentpay-store-journal.json"); expect(maxDuration).toBe(300);
});
it("later completion event cannot create a second payment for the same Task", async () => {
  const b = bundle(); const paid = await payer();
  expect((await handleStorePay(request(), { env: options, fetch: coreFetch(b), pay: paid.pay })).status).toBe(200);
  const response = await handleStorePay(request(), { env: options, fetch: coreFetch(b, { eventId: "new-event" }), pay: paid.pay });
  expect(await response.json()).toEqual({ txHash: paid.txHash, status: "confirmed" }); expect(paid.sign).toHaveBeenCalledTimes(1);
});
it("overlapping payment requests cannot acquire a second signature", async () => {
  const b = bundle(); const paid = await payer();
  const responses = await Promise.all([0, 1].map(() => handleStorePay(request(), { env: options, fetch: coreFetch(b), pay: paid.pay })));
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(paid.sign).toHaveBeenCalledTimes(1); expect(paid.sent).toHaveLength(1);
  expect((await handleStorePay(request(), { env: options, fetch: coreFetch(b), pay: paid.pay })).status).toBe(200);
});
it.each(["payTo", "amount", "asset", "network", "scheme"])("a signed APPROVE for the wrong store %s cannot pay", async (field) => {
  const changed: SpendProposal = { ...proposal, requirements: { ...proposal.requirements, [field]: field === "payTo" ? guardAddress
    : field === "amount" ? "28000000" : field === "asset" ? `${"ab".repeat(28)}.00` : field === "network" ? "cardano:preview" : "other" } };
  const pay = vi.fn();
  expect((await handleStorePay(request(), { env: options, fetch: coreFetch(bundle(), { proposal: changed }), pay })).status).toBe(409);
  expect(pay).not.toHaveBeenCalled();
});
it.each([{ verdict: "REFUSE" as const }, { badSignature: true }, { digest: "mandateDigest" as const }, { digest: "proposalDigest" as const },
  { signedTaskId: "wrong-task" }, { status: "RUNNING" }])("rejects untrusted or non-APPROVE receipt %j without payment", async (settings) => {
  const pay = vi.fn(); const response = await handleStorePay(request(), { env: options, fetch: coreFetch(bundle(), settings), pay });
  expect(response.status).toBe(409); expect(pay).not.toHaveBeenCalled();
});
it("rejects TTL beyond Mandate expiry before a paid request", async () => {
  const b = bundle(); const paid = await payer({ ttl: Time.unixTimeToSlot(BigInt(b.mandate.expiry + 1) * 1000n, SlotConfig.getSlotConfig("Preprod")) });
  expect((await handleStorePay(request(), { env: options, fetch: coreFetch(b), pay: paid.pay })).status).toBe(409);
  expect(paid.sent).toHaveLength(0);
});
it("changed requirements cannot release a signature", async () => {
  const paid = await payer({ changed: true });
  expect((await handleStorePay(request(), { env: options, fetch: coreFetch(bundle()), pay: paid.pay })).status).toBe(409);
  expect(paid.sign).not.toHaveBeenCalled(); expect(paid.sent).toHaveLength(0);
});
it("nonce_not_on_chain resolves against the saved transaction hash", async () => {
  const paid = await payer({ chain: true });
  const response = await handleStorePay(request(), { env: options, fetch: coreFetch(bundle()), pay: paid.pay });
  expect(await response.json()).toEqual({ txHash: paid.txHash, status: "confirmed-on-chain" });
});
it.each([{}, { taskId: "bad/id" }, { taskId, mandateBundle: "untrusted" }])("pay body accepts only a safe Task ID: %j", async (body) => {
  const fetcher = vi.fn<typeof fetch>(); const response = await handleStorePay(request(body), { env: options, fetch: fetcher, pay: vi.fn() });
  expect(response.status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
});
it("redacts provider errors and disables payment when wallet configuration is missing", async () => {
  const log = vi.spyOn(console, "log"); const error = vi.spyOn(console, "error");
  const response = await handleStorePay(request(), { env: options, fetch: coreFetch(bundle()),
    pay: async () => { throw new Error(Object.values(env).join(" ")); } });
  expect(response.status).toBe(409);
  const text = await response.text(); for (const secret of [env.STORE_LIVE_KEY, env.ORCHESTRATOR_WALLET_MNEMONIC, env.BLOCKFROST_API_KEY_PREPROD]) expect(text).not.toContain(secret);
  expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  const fetcher = vi.fn<typeof fetch>();
  expect((await handleStorePay(request(), { env: { ...options, ORCHESTRATOR_WALLET_MNEMONIC: "" }, fetch: fetcher, pay: vi.fn() })).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it("the real POST route denies missing live key without configuration or network", async () => {
  vi.stubEnv("STORE_LIVE_KEY", ""); expect((await POST(request({}, null))).status).toBe(403);
});
it("validates a live Mandate cryptographically and rejects wrong signed payee/amount, asset, expiry and signature", () => {
  const b = bundle(); expect(validateStoreMandate(b)).toEqual(b);
  const wrongPayee = createDevMandate({ payee: guardAddress, amount: "6500000" });
  const wrongAmount = createDevMandate({ payee: STORE_PAYEE, amount: "28000000" });
  const bytes = Buffer.from(b.coseSign1, "hex"); bytes[bytes.length - 1] ^= 1;
  for (const invalid of [wrongPayee, wrongAmount, { ...b, coseSign1: bytes.toString("hex") }, null]) expect(() => validateStoreMandate(invalid)).toThrow();
  const altered = (fields: Partial<MandateBundle["mandate"]>) => {
    const mandate = { ...b.mandate, ...fields, payer: guardAddress };
    const signed = COSE.SignData.signData(Address.toHex(Address.fromBech32(guardAddress)), Buffer.from(jcs(mandate), "utf8"), key);
    return { mandate, payerAddress: guardAddress, digest: mandateDigest(mandate),
      coseSign1: Buffer.from(signed.signature).toString("hex"), coseKey: Buffer.from(signed.key).toString("hex") };
  };
  expect(() => validateStoreMandate(altered({ expiry: Math.floor(Date.now() / 1000) - 1 }))).toThrow();
  expect(() => validateStoreMandate(altered({ asset: `${"ab".repeat(28)}.00` }))).toThrow();
});
