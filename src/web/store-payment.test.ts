import { PGlite } from "@electric-sql/pglite";
import { Address, CBOR, COSE, KeyHash, PrivateKey, SlotConfig, Time, Transaction, TransactionBody, TransactionHash } from "@evolution-sdk/evolution";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { jcs, mandateDigest, proposalDigest, signReceipt, type MandateBundle, type SpendProposal } from "../guard";
import { createDevMandate } from "../orchestrator/mandate";
import type { PaymentDeps } from "../orchestrator/payment";
import { StopError } from "../orchestrator/journal";
import type { Db } from "../worker/db";
import { createStorePaymentRunner, type StorePaymentDb } from "./store-payment-db.server";
import { blockfrostLookup, walletHeaders } from "../orchestrator/payment";
import { createLatteHandler } from "./store-seller.server";
import { handleStorePay as storePayService } from "./store-payment.server";
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
  SOKOSUMI_API_URL: "https://api.preprod.sokosumi.com", SOKOSUMI_COWORKER_API_KEY: "core-test-placeholder",
  STORE_PAY_DATABASE_URL: "postgres://store_pay:database-test-placeholder@invalid/store" };
const key = PrivateKey.fromHex("03".repeat(32));
const guardAddress = Address.toBech32(Address.fromHex(`60${KeyHash.toHex(KeyHash.fromPrivateKey(key))}`));
const options = { ...env, GUARD_ADDRESS: guardAddress };
const taskId = "store-task";
const endpoint = "https://store.test/api/store/latte";
let database: PGlite;
let db: Db;
beforeAll(async () => {
  database = new PGlite();
  db = { query: (text, params) => database.query(text, params) };
  // Test fixture only. Production must use orch's existing table and restricted role.
  await db.query(`CREATE TABLE store_payments (task_id text PRIMARY KEY, event_id text NOT NULL,
    state text NOT NULL CHECK (state IN ('signing','prepared','done')), proposal_digest text NOT NULL,
    headers jsonb, tx_hash text, payment jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
}, 20_000);
beforeEach(async () => { await db.query("TRUNCATE store_payments"); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const handleStorePay: typeof storePayService = (request, settings = {}) => storePayService(request, { db, ...settings });
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
    const saved = (await db.query("SELECT state, headers, tx_hash FROM store_payments WHERE task_id=$1", [taskId])).rows[0];
    expect(saved).toEqual({ state: "prepared", headers, tx_hash: txHash });
    return settings.chain ? new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ ...required, error: "nonce_not_on_chain" })).toString("base64") } })
      : new Response("{}", { headers: { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify({ success: true, network: "cardano:preprod", transaction: txHash })).toString("base64") } });
  });
  const deps: PaymentDeps = { fetch: paymentFetch, createHeaders: sign, sleep: async () => {}, lookupTransaction: async () => true, log: () => {} };
  const runner = (runnerDb: Db = { query: (text, params) => db.query(text, params) }, overrides: Partial<PaymentDeps> = {}) =>
    createStorePaymentRunner({ db: runnerDb, deps: { ...deps, ...overrides } });
  return { pay: runner(), runner, sign, sent, txHash, headers, paymentFetch };
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
  expect((await db.query("SELECT * FROM store_payments")).rows).toMatchObject([{ task_id: taskId, event_id: "event-complete", state: "done", payment: { txHash: paid.txHash } }]);
  expect(maxDuration).toBe(300);
});
it("later completion event cannot create a second payment for the same Task", async () => {
  const b = bundle(); const paid = await payer();
  expect((await handleStorePay(request(), { env: options, fetch: coreFetch(b), pay: paid.pay })).status).toBe(200);
  const response = await handleStorePay(request(), { env: options, fetch: coreFetch(b, { eventId: "new-event" }), pay: paid.pay });
  expect(await response.json()).toEqual({ txHash: paid.txHash, status: "confirmed" }); expect(paid.sign).toHaveBeenCalledTimes(1);
});
it("overlapping payment requests cannot acquire a second signature", async () => {
  const b = bundle(); const paid = await payer();
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const first = handleStorePay(request(), { env: options, fetch: coreFetch(b),
    pay: paid.runner(undefined, { createHeaders: async () => { entered(); await gate; return paid.sign(); } }) });
  await started;
  const second = await handleStorePay(request(), { env: options, fetch: coreFetch(b), pay: paid.runner() });
  release();
  expect(second.status).toBe(409); expect(await second.json()).toEqual({ error: "Payment signing is interrupted or in progress. No second transaction will be signed; inspect the durable store payment." });
  expect((await first).status).toBe(200);
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
  expect(log).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledTimes(1);
  const logged = JSON.stringify(error.mock.calls);
  for (const secret of [env.STORE_LIVE_KEY, env.ORCHESTRATOR_WALLET_MNEMONIC, env.BLOCKFROST_API_KEY_PREPROD, env.STORE_PAY_DATABASE_URL]) expect(logged).not.toContain(secret);
  const fetcher = vi.fn<typeof fetch>();
  expect((await handleStorePay(request(), { env: { ...options, ORCHESTRATOR_WALLET_MNEMONIC: "" }, fetch: fetcher, pay: vi.fn() })).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it("the real POST route denies missing live key without configuration or network", async () => {
  vi.stubEnv("STORE_LIVE_KEY", ""); expect((await POST(request({}, null))).status).toBe(403);
});
it("missing durable database configuration disables live payment with no fallback", async () => {
  const fetcher = vi.fn<typeof fetch>(); const pay = vi.fn();
  const response = await handleStorePay(request(), { env: { ...options, STORE_PAY_DATABASE_URL: "" }, fetch: fetcher, pay });
  expect(response.status).toBe(403); expect(fetcher).not.toHaveBeenCalled(); expect(pay).not.toHaveBeenCalled();
});
it("the exported POST denies missing STORE_PAY_DATABASE_URL before Core or wallet I/O", async () => {
  for (const [name, value] of Object.entries(options)) vi.stubEnv(name, value);
  vi.stubEnv("STORE_PAY_DATABASE_URL", "");
  const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no I/O permitted"));
  expect((await POST(request())).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
});
it("independent runners return the durable saved result without a new signature, even with another event ID", async () => {
  const paid = await payer(); const expiry = bundle().mandate.expiry;
  const id = { taskId, eventId: "original-event", action: "pay" as const };
  expect(await paid.pay(proposal, endpoint, id, expiry)).toMatchObject({ txHash: paid.txHash });
  expect(await paid.runner()(proposal, endpoint, { ...id, eventId: "later-event" }, expiry)).toMatchObject({ txHash: paid.txHash });
  expect(paid.sign).toHaveBeenCalledTimes(1); expect(paid.sent).toHaveLength(1);
  expect((await db.query("SELECT event_id FROM store_payments")).rows).toEqual([{ event_id: "original-event" }]);
});
it("a restarted runner fails closed after interrupted signing and never signs again", async () => {
  const paid = await payer(); const expiry = bundle().mandate.expiry;
  const id = { taskId, eventId: "original-event", action: "pay" as const };
  paid.sign.mockRejectedValueOnce(new Error("mnemonic-test-placeholder provider-test-placeholder"));
  await expect(paid.pay(proposal, endpoint, id, expiry)).rejects.toThrow();
  expect((await db.query("SELECT state, headers FROM store_payments")).rows).toEqual([{ state: "signing", headers: null }]);
  await expect(paid.runner()(proposal, endpoint, id, expiry)).rejects.toThrow("No second transaction will be signed");
  expect(paid.sign).toHaveBeenCalledTimes(1); expect(paid.sent).toHaveLength(0);
});
it("durable prepared bytes survive a database restart and recover on chain without signing", async () => {
  const paid = await payer(); const expiry = bundle().mandate.expiry;
  const id = { taskId, eventId: "original-event", action: "pay" as const };
  const interrupted = paid.runner(undefined, { fetch: async (url, init) => {
    if (!init?.headers) return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ x402Version: 2, accepts: [proposal.requirements] })).toString("base64") } });
    throw new Error(`interrupted at ${url}`);
  }, sleep: async () => { throw new Error("simulate process exit"); } });
  await expect(interrupted(proposal, endpoint, id, expiry)).rejects.toThrow();
  expect((await db.query("SELECT state, headers, tx_hash FROM store_payments")).rows).toEqual([{ state: "prepared", headers: paid.headers, tx_hash: paid.txHash }]);
  const snapshot = await database.dumpDataDir();
  const restarted = new PGlite({ loadDataDir: snapshot });
  try {
    const newDb: Db = { query: (text, params) => restarted.query(text, params) };
    const fetchPaid = vi.fn(); const lookupTransaction = vi.fn(async () => true);
    expect(await paid.runner(newDb, { fetch: fetchPaid, lookupTransaction })(proposal, endpoint, id, expiry))
      .toEqual({ txHash: paid.txHash, network: "cardano:preprod", status: "confirmed-on-chain" });
    expect(fetchPaid).not.toHaveBeenCalled(); expect(lookupTransaction).toHaveBeenCalledWith(paid.txHash);
    expect((await newDb.query("SELECT state, headers FROM store_payments")).rows).toEqual([{ state: "done", headers: paid.headers }]);
    expect(paid.sign).toHaveBeenCalledTimes(1);
  } finally { await restarted.close(); }
}, 20_000);
it("transport retries send only the durable original bytes and obtain at most one signature", async () => {
  const paid = await payer(); const expiry = bundle().mandate.expiry;
  const bytes: string[] = []; let first = true;
  const retry = paid.runner(undefined, { fetch: async (_url, init) => {
    if (!init?.headers) return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ x402Version: 2, accepts: [proposal.requirements] })).toString("base64") } });
    bytes.push(new Headers(init.headers).get("PAYMENT-SIGNATURE")!);
    expect((await db.query("SELECT state, headers FROM store_payments")).rows).toEqual([{ state: "prepared", headers: paid.headers }]);
    if (first) { first = false; throw new Error("lost transport"); }
    return new Response("{}", { headers: { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify({ success: true, network: "cardano:preprod", transaction: paid.txHash })).toString("base64") } });
  } });
  expect(await retry(proposal, endpoint, { taskId, eventId: "event", action: "pay" }, expiry)).toMatchObject({ txHash: paid.txHash });
  expect(bytes).toEqual([paid.headers["PAYMENT-SIGNATURE"], paid.headers["PAYMENT-SIGNATURE"]]); expect(paid.sign).toHaveBeenCalledTimes(1);
});
it.each(["signing", "prepared", "done"])("proposal mismatch against durable %s refuses before signing or sending", async (state) => {
  const paid = await payer(); const expiry = bundle().mandate.expiry;
  await db.query("INSERT INTO store_payments(task_id,event_id,state,proposal_digest,headers,tx_hash,payment) VALUES($1,'event',$2,$3,$4,$5,$6)",
    [taskId, state, "ab".repeat(32), paid.headers, paid.txHash, { txHash: paid.txHash, network: "cardano:preprod", status: "confirmed" }]);
  await expect(paid.pay(proposal, endpoint, { taskId, eventId: "event", action: "pay" }, expiry)).rejects.toThrow("proposal");
  expect(paid.sign).not.toHaveBeenCalled(); expect(paid.sent).toHaveLength(0);
});
it("a failed durable prepare save blocks sending and never permits a second signature", async () => {
  const paid = await payer(); const expiry = bundle().mandate.expiry;
  const faulty: Db = { query: (text, params) => {
    if (text.includes("UPDATE") && text.includes("prepared")) throw new Error(env.STORE_PAY_DATABASE_URL);
    return db.query(text, params);
  } };
  const id = { taskId, eventId: "event", action: "pay" as const };
  await expect(paid.runner(faulty)(proposal, endpoint, id, expiry)).rejects.toThrow();
  expect(paid.sent).toHaveLength(0); expect(paid.sign).toHaveBeenCalledTimes(1);
  await expect(paid.runner()(proposal, endpoint, id, expiry)).rejects.toThrow("No second transaction will be signed");
  expect(paid.sign).toHaveBeenCalledTimes(1);
});
it("a restart before the first broadcast sends only the durable prepared bytes", async () => {
  const paid = await payer(); const expiry = bundle().mandate.expiry;
  await db.query("INSERT INTO store_payments(task_id,event_id,state,proposal_digest,headers,tx_hash) VALUES($1,'first-event','prepared',$2,$3,$4)",
    [taskId, proposalDigest(proposal), paid.headers, paid.txHash]);
  const runner = paid.runner(undefined, { lookupTransaction: async () => false, sleep: async () => { throw new Error("no broadcast to confirm"); } });
  await expect(runner(proposal, endpoint, { taskId, eventId: "second-event", action: "pay" }, expiry)).resolves.toMatchObject({ txHash: paid.txHash });
  expect(paid.sent).toEqual([paid.headers["PAYMENT-SIGNATURE"]]); expect(paid.sign).not.toHaveBeenCalled();
});
it("a saved payment remains recoverable after Mandate expiry without signing again", async () => {
  const b = bundle(); const paid = await payer();
  expect((await handleStorePay(request(), { env: options, fetch: coreFetch(b), pay: paid.pay })).status).toBe(200);
  vi.spyOn(Date, "now").mockReturnValue((b.mandate.expiry + 1) * 1000);
  const response = await handleStorePay(request(), { env: options, fetch: coreFetch(b), pay: paid.runner() });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ txHash: paid.txHash, status: "confirmed" });
  expect(paid.sign).toHaveBeenCalledTimes(1); expect(paid.sent).toHaveLength(1);
});
it("a lost done update recovers the original prepared transaction without signing again", async () => {
  const paid = await payer(); const expiry = bundle().mandate.expiry;
  const faulty: Db = { query: (text, params) => {
    if (text.includes("UPDATE") && text.includes("state='done'")) throw new Error("lost done write");
    return db.query(text, params);
  } };
  const id = { taskId, eventId: "event", action: "pay" as const };
  await expect(paid.runner(faulty)(proposal, endpoint, id, expiry)).rejects.toThrow();
  expect((await db.query("SELECT state FROM store_payments")).rows).toEqual([{ state: "prepared" }]);
  expect(await paid.runner()(proposal, endpoint, id, expiry)).toMatchObject({ txHash: paid.txHash, status: "confirmed-on-chain" });
  expect(paid.sign).toHaveBeenCalledTimes(1); expect(paid.sent).toHaveLength(1);
});
it("the restricted Postgres role can pay without DDL or other table permissions", async () => {
  await db.query("CREATE ROLE store_pay_test");
  await db.query("GRANT SELECT,INSERT,UPDATE ON store_payments TO store_pay_test");
  await db.query("SET ROLE store_pay_test");
  try {
    const paid = await payer();
    expect(await paid.pay(proposal, endpoint, { taskId, eventId: "event", action: "pay" }, bundle().mandate.expiry)).toMatchObject({ txHash: paid.txHash });
  } finally { await db.query("RESET ROLE"); }
});
it("a lost INSERT acknowledgement leaves a durable signing claim and never allows signing on retry", async () => {
  const paid = await payer(); const expiry = bundle().mandate.expiry;
  const faulty: Db = { async query<T>(text: string, params?: unknown[]) {
    const result = await db.query<T>(text, params);
    if (text.includes("INSERT")) throw new Error(env.STORE_PAY_DATABASE_URL);
    return result;
  } };
  const id = { taskId, eventId: "event", action: "pay" as const };
  const response = await handleStorePay(request(), { env: options, fetch: coreFetch(bundle()), pay: paid.runner(faulty) });
  expect(response.status).toBe(409); expect(await response.text()).not.toContain(env.STORE_PAY_DATABASE_URL);
  expect((await db.query("SELECT state FROM store_payments")).rows).toEqual([{ state: "signing" }]);
  await expect(paid.runner()(proposal, endpoint, id, expiry)).rejects.toThrow("No second transaction will be signed");
  expect(paid.sign).not.toHaveBeenCalled(); expect(paid.sent).toHaveLength(0);
});
it("a durable prepared hash that differs from the original signed bytes refuses without signing or sending", async () => {
  const paid = await payer();
  await db.query("INSERT INTO store_payments(task_id,event_id,state,proposal_digest,headers,tx_hash) VALUES($1,'event','prepared',$2,$3,$4)",
    [taskId, proposalDigest(proposal), paid.headers, "ab".repeat(32)]);
  await expect(paid.runner()(proposal, endpoint, { taskId, eventId: "event", action: "pay" }, bundle().mandate.expiry)).rejects.toThrow("hash mismatch");
  expect(paid.sign).not.toHaveBeenCalled(); expect(paid.sent).toHaveLength(0);
});
it.each(["transport", "http-503", "changed-402", "expiry"])("read-only %s failure leaves no durable claim and no signature", async (failure) => {
  const paid = await payer(); const id = { taskId, eventId: "event", action: "pay" as const };
  const expiry = failure === "expiry" ? Math.floor(Date.now() / 1000) + 599 : bundle().mandate.expiry;
  const fetcher = vi.fn<PaymentDeps["fetch"]>(async () => {
    expect((await db.query("SELECT * FROM store_payments")).rows).toEqual([]);
    if (failure === "transport") throw new Error("transient seller GET failure");
    if (failure === "http-503") return new Response("unavailable", { status: 503 });
    return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ x402Version: 2,
      accepts: [{ ...proposal.requirements, amount: "28000000" }] })).toString("base64") } });
  });
  await expect(paid.runner(undefined, { fetch: fetcher })(proposal, endpoint, id, expiry)).rejects.toThrow();
  expect((await db.query("SELECT * FROM store_payments")).rows).toEqual([]);
  expect(paid.sign).not.toHaveBeenCalled(); expect(paid.sent).toHaveLength(0);
  if (failure === "expiry") expect(fetcher).not.toHaveBeenCalled();
  expect(await paid.runner()(proposal, endpoint, id, bundle().mandate.expiry)).toMatchObject({ txHash: paid.txHash });
  expect(paid.sign).toHaveBeenCalledTimes(1); expect(paid.sent).toHaveLength(1);
});
it("two instances retrying a transient fresh GET failure both check before the claim, then obtain only one signature", async () => {
  const paid = await payer(); const id = { taskId, eventId: "event", action: "pay" as const }; const expiry = bundle().mandate.expiry;
  await expect(paid.runner(undefined, { fetch: async () => { throw new Error("transient GET failure"); } })(proposal, endpoint, id, expiry)).rejects.toThrow();
  expect((await db.query("SELECT * FROM store_payments")).rows).toEqual([]); expect(paid.sign).not.toHaveBeenCalled();
  let releaseFresh!: () => void; let bothFresh!: () => void; let freshCalls = 0;
  const freshGate = new Promise<void>((resolve) => { releaseFresh = resolve; });
  const freshStarted = new Promise<void>((resolve) => { bothFresh = resolve; });
  let releaseSign!: () => void; let enteredSign!: () => void;
  const signGate = new Promise<void>((resolve) => { releaseSign = resolve; });
  const signStarted = new Promise<void>((resolve) => { enteredSign = resolve; });
  const overrides: Partial<PaymentDeps> = {
    fetch: async (url, init) => {
      if (!init?.headers) {
        expect((await db.query("SELECT * FROM store_payments")).rows).toEqual([]);
        if (++freshCalls === 2) bothFresh();
        await freshGate;
      }
      return paid.paymentFetch(url, init);
    },
    createHeaders: async () => { enteredSign(); await signGate; return paid.sign(); },
  };
  const attempts = [paid.runner(undefined, overrides), paid.runner(undefined, overrides)].map((run) =>
    run(proposal, endpoint, id, expiry).then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })));
  try {
    await freshStarted; releaseFresh(); await signStarted;
    const loser = await Promise.race(attempts);
    expect(loser.ok).toBe(false);
    if (!loser.ok) expect(loser.error).toHaveProperty("message", "Payment signing is interrupted or in progress. No second transaction will be signed; inspect the durable store payment.");
  } finally { releaseFresh(); releaseSign(); }
  const results = await Promise.all(attempts);
  expect(results.filter((result) => result.ok)).toHaveLength(1); expect(freshCalls).toBe(2);
  expect(paid.sign).toHaveBeenCalledTimes(1); expect(paid.sent).toEqual([paid.headers["PAYMENT-SIGNATURE"]]);
  expect(await paid.runner()(proposal, endpoint, id, expiry)).toMatchObject({ txHash: paid.txHash });
  expect(paid.sign).toHaveBeenCalledTimes(1);
});
it.each(["done", "prepared"])("a losing claim recovers a competing instance's %s state without signing", async (state) => {
  const paid = await payer(); const expiry = bundle().mandate.expiry; const id = { taskId, eventId: "original-event", action: "pay" as const };
  const competingDb: Db = { query: (text, params) => {
    if (state === "prepared" && text.includes("UPDATE") && text.includes("state='done'")) throw new Error("lost done update");
    return db.query(text, params);
  } };
  const runner = paid.runner(undefined, { fetch: async (url, init) => {
    if (!init?.headers) {
      // This runner has already read no row. The competitor now signs once.
      const competing = paid.runner(competingDb)(proposal, endpoint, id, expiry);
      if (state === "prepared") await expect(competing).rejects.toThrow("database operation failed");
      else expect(await competing).toMatchObject({ txHash: paid.txHash });
    }
    return paid.paymentFetch(url, init);
  } });
  expect(await runner(proposal, endpoint, { ...id, eventId: "late-event" }, expiry)).toEqual({ txHash: paid.txHash,
    network: "cardano:preprod", status: state === "done" ? "confirmed" : "confirmed-on-chain" });
  expect(paid.sign).toHaveBeenCalledTimes(1); expect(paid.sent).toHaveLength(1);
  expect((await db.query("SELECT event_id,state FROM store_payments")).rows).toEqual([{ event_id: "original-event", state: "done" }]);
});
it("a slow fresh GET that consumes the remaining expiry allowance leaves no signing claim", async () => {
  const clock = Date.now(); vi.spyOn(Date, "now").mockReturnValue(clock);
  const paid = await payer(); const expiry = Math.floor(clock / 1000) + 610;
  const runner = paid.runner(undefined, { fetch: async (url, init) => {
    vi.mocked(Date.now).mockReturnValue(clock + 20_000);
    return paid.paymentFetch(url, init);
  } });
  await expect(runner(proposal, endpoint, { taskId, eventId: "event", action: "pay" }, expiry)).rejects.toThrow("Mandate expires");
  expect((await db.query("SELECT * FROM store_payments")).rows).toEqual([]); expect(paid.sign).not.toHaveBeenCalled(); expect(paid.sent).toHaveLength(0);
});
it("a failed done write after successful settlement recovers in the same request with one signature", async () => {
  const b = bundle(); const paid = await payer(); let fail = true;
  const faulty: Db = { query: (text, params) => {
    if (fail && text.includes("UPDATE") && text.includes("state='done'")) {
      fail = false;
      throw Object.assign(new Error(Object.values(env).join(" ")), { code: "08006", detail: paid.headers });
    }
    return db.query(text, params);
  } };
  const pay = vi.fn(paid.runner(faulty));
  const response = await handleStorePay(request(), { env: options, fetch: coreFetch(b), pay });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ txHash: paid.txHash, status: "confirmed-on-chain" });
  expect(pay).toHaveBeenCalledTimes(2); expect(paid.sign).toHaveBeenCalledTimes(1); expect(paid.sent).toHaveLength(1);
  expect((await db.query("SELECT state,payment FROM store_payments")).rows).toMatchObject([{ state: "done", payment: { txHash: paid.txHash } }]);
  const log = vi.mocked(console.error).mock.calls;
  expect(log).toHaveLength(1);
  expect(log[0]).toEqual(["[store-pay] failure", { stage: "payment", errorClass: "StorePaymentDatabaseError", operation: "done", pgCode: "08006",
    message: "Durable store payment database operation failed; inspect saved state before retrying." }]);
  const logged = JSON.stringify(log);
  for (const secret of [...Object.values(env), paid.headers["PAYMENT-SIGNATURE"]]) if (secret !== "test") expect(logged).not.toContain(secret);
});
it("a first payment persists prepared only once and completes without an unchanged rewrite", async () => {
  const paid = await payer(); let prepares = 0;
  const guarded: Db = { query: (text, params) => {
    if (text.includes("SET state='prepared'") && ++prepares > 1) return Promise.resolve({ rows: [] });
    return db.query(text, params);
  } };
  const pay = vi.fn(paid.runner(guarded));
  const response = await handleStorePay(request(), { env: options, fetch: coreFetch(bundle()), pay });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ txHash: paid.txHash, status: "confirmed" });
  expect(prepares).toBe(1); expect(pay).toHaveBeenCalledTimes(1); expect(paid.sign).toHaveBeenCalledTimes(1);
  expect(paid.sent).toEqual([paid.headers["PAYMENT-SIGNATURE"]]);
});
it("a prepared resume does not rewrite bytes and completes by hash despite a different JSON header representation", async () => {
  const paid = await payer(); const expiry = bundle().mandate.expiry;
  await db.query("INSERT INTO store_payments(task_id,event_id,state,proposal_digest,headers,tx_hash) VALUES($1,$2,'prepared',$3,$4,$5)",
    [taskId, "event", proposalDigest(proposal), JSON.stringify(paid.headers), paid.txHash]);
  let prepares = 0;
  const guarded: Db = { query: (text, params) => {
    if (text.includes("SET state='prepared'")) prepares++;
    return db.query(text, params);
  } };
  const equivalentHeaders = { "payment-signature": paid.headers["PAYMENT-SIGNATURE"] };
  const lookupTransaction = async () => {
    // Same signature bytes, different JSON shape: emulate representation drift.
    await db.query("UPDATE store_payments SET headers=$1::jsonb WHERE task_id=$2", [JSON.stringify(equivalentHeaders), taskId]);
    return true;
  };
  await expect(paid.runner(guarded, { lookupTransaction })(proposal, endpoint, { taskId, eventId: "event", action: "pay" }, expiry))
    .resolves.toEqual({ txHash: paid.txHash, network: "cardano:preprod", status: "confirmed-on-chain" });
  expect(prepares).toBe(0); expect(paid.sign).not.toHaveBeenCalled(); expect(paid.sent).toHaveLength(0);
  expect((await db.query("SELECT state,headers,tx_hash FROM store_payments")).rows)
    .toEqual([{ state: "done", headers: equivalentHeaders, tx_hash: paid.txHash }]);
});
it("completion still refuses if the saved transaction hash changes during confirmation", async () => {
  const paid = await payer(); const expiry = bundle().mandate.expiry;
  await db.query("INSERT INTO store_payments(task_id,event_id,state,proposal_digest,headers,tx_hash) VALUES($1,$2,'prepared',$3,$4,$5)",
    [taskId, "event", proposalDigest(proposal), JSON.stringify(paid.headers), paid.txHash]);
  const lookupTransaction = async () => {
    await db.query("UPDATE store_payments SET tx_hash=$1 WHERE task_id=$2", ["ab".repeat(32), taskId]);
    return true;
  };
  await expect(paid.runner(undefined, { lookupTransaction })(proposal, endpoint, { taskId, eventId: "event", action: "pay" }, expiry))
    .rejects.toThrow("durable payment state changed");
  expect((await db.query("SELECT state FROM store_payments")).rows).toEqual([{ state: "prepared" }]);
  expect(paid.sign).not.toHaveBeenCalled(); expect(paid.sent).toHaveLength(0);
});
it("same-request recovery is attempted once and preserves prepared bytes if the done write still fails", async () => {
  const b = bundle(); const paid = await payer();
  const faulty: Db = { query: (text, params) => {
    if (text.includes("UPDATE") && text.includes("state='done'")) throw Object.assign(new Error("private SQL params"), { code: "40001" });
    return db.query(text, params);
  } };
  const pay = vi.fn(paid.runner(faulty));
  const response = await handleStorePay(request(), { env: options, fetch: coreFetch(b), pay });
  expect(response.status).toBe(409); expect(pay).toHaveBeenCalledTimes(2); expect(paid.sign).toHaveBeenCalledTimes(1); expect(paid.sent).toHaveLength(1);
  expect((await db.query("SELECT state,headers FROM store_payments")).rows).toEqual([{ state: "prepared", headers: paid.headers }]);
  expect(vi.mocked(console.error).mock.calls.map((call) => call[1])).toMatchObject([{ stage: "payment", pgCode: "40001" }, { stage: "recovery", pgCode: "40001" }]);
});
it("sanitized StopError logs retain known messages and omit arbitrary private text", async () => {
  const response = await handleStorePay(request(), { env: options, fetch: coreFetch(bundle()), pay: async () => {
    throw new StopError(`${env.STORE_LIVE_KEY} PAYMENT-SIGNATURE private SQL params`);
  } });
  expect(response.status).toBe(409);
  expect(vi.mocked(console.error).mock.calls).toEqual([["[store-pay] failure", { stage: "payment", errorClass: "StopError", message: "Unrecognized StopError message omitted." }]]);
});
it("recovery cannot acquire a new claim if the prepared row disappears", async () => {
  const paid = await payer();
  await expect(paid.runner()(proposal, endpoint, { taskId, eventId: "event", action: "pay" }, bundle().mandate.expiry,
    { recoveryOnly: true })).rejects.toThrow("prepared payment unavailable for recovery; no signing");
  expect(paid.sign).not.toHaveBeenCalled(); expect(paid.paymentFetch).not.toHaveBeenCalled();
  expect((await db.query("SELECT * FROM store_payments")).rows).toEqual([]);
});
it("same-request recovery waits at most 90 seconds and retains the original bytes", async () => {
  const b = bundle(); const paid = await payer(); const startedAt = Date.now(); let now = startedAt;
  await db.query("INSERT INTO store_payments(task_id,event_id,state,proposal_digest,headers,tx_hash) VALUES($1,$2,'prepared',$3,$4,$5)",
    [taskId, "event-complete", proposalDigest(proposal), JSON.stringify(paid.headers), paid.txHash]);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const lookup = vi.fn(async () => false);
  const fetchPaid = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("PAYMENT-SIGNATURE")).toBe(paid.headers["PAYMENT-SIGNATURE"]);
    return new Response("{}", { status: 503 });
  });
  const pay = vi.fn(paid.runner(undefined, { fetch: fetchPaid, lookupTransaction: lookup, sleep: async (ms) => { now += ms; } }))
    .mockImplementationOnce(async () => { now += 195_000; throw new StopError("payment request deadline reached; saved state retained"); });
  const response = await handleStorePay(request(), { env: options, fetch: coreFetch(b), pay });
  expect(response.status).toBe(409); expect(now - startedAt).toBe(285_000); expect(pay).toHaveBeenCalledTimes(2);
  expect(pay.mock.calls[1][4]).toEqual({ recoveryOnly: true, deadlineMs: startedAt + 285_000 });
  expect(lookup.mock.calls.length).toBeGreaterThan(1); expect(fetchPaid).toHaveBeenCalledTimes(1); expect(paid.sign).not.toHaveBeenCalled();
  expect((await db.query("SELECT state,headers,tx_hash FROM store_payments")).rows).toEqual([{ state: "prepared", headers: paid.headers, tx_hash: paid.txHash }]);
});
it("chain lookups receive a recovery deadline signal", async () => {
  const paid = await payer();
  await db.query("INSERT INTO store_payments(task_id,event_id,state,proposal_digest,headers,tx_hash) VALUES($1,$2,'prepared',$3,$4,$5)",
    [taskId, "event", proposalDigest(proposal), JSON.stringify(paid.headers), paid.txHash]);
  const lookup = vi.fn<PaymentDeps["lookupTransaction"]>(async () => true);
  await expect(paid.runner(undefined, { lookupTransaction: lookup })(proposal, endpoint, { taskId, eventId: "event", action: "pay" },
    bundle().mandate.expiry, { recoveryOnly: true, deadlineMs: Date.now() + 90_000 })).resolves.toMatchObject({ txHash: paid.txHash });
  expect(lookup).toHaveBeenCalledTimes(1); expect(lookup.mock.calls[0][1]).toBeInstanceOf(AbortSignal); expect(paid.sign).not.toHaveBeenCalled();
});
it.each(["read", "claim", "prepared", "done"])("a delayed journal %s stops before the next operation and preserves durable state", async (stage) => {
  const paid = await payer(); const expiry = bundle().mandate.expiry; let now = Date.now(); const deadlineMs = now + 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const delayed: StorePaymentDb = { async query<T>(text: string, params?: unknown[], callOptions?: { deadlineMs?: number }) {
    expect(callOptions?.deadlineMs).toBe(deadlineMs);
    const result = await db.query<T>(text, params);
    if ((stage === "read" && text.startsWith("SELECT")) || (stage === "claim" && text.startsWith("INSERT"))
      || (stage === "prepared" && text.includes("SET state='prepared'")) || (stage === "done" && text.includes("SET state='done'"))) now = deadlineMs;
    return result;
  } };
  await expect(paid.runner(delayed)(proposal, endpoint, { taskId, eventId: "event", action: "pay" }, expiry, { deadlineMs }))
    .rejects.toThrow("payment request deadline reached");
  const rows = (await db.query("SELECT state,headers FROM store_payments")).rows;
  if (stage === "read") expect(rows).toEqual([]);
  else expect(rows).toMatchObject([{ state: stage === "claim" ? "signing" : stage, headers: stage === "claim" ? null : paid.headers }]);
  expect(paid.sign).toHaveBeenCalledTimes(stage === "read" || stage === "claim" ? 0 : 1);
  expect(paid.sent).toHaveLength(stage === "done" ? 1 : 0);
});
it("a slow signer times out with its claim retained and late bytes never broadcast", async () => {
  const paid = await payer(); const expiry = bundle().mandate.expiry;
  let entered!: () => void; const signing = new Promise<void>((resolve) => { entered = resolve; });
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const signer = vi.fn(async () => { entered(); await gate; return paid.sign(); });
  vi.useFakeTimers();
  const attempt = paid.runner(undefined, { createHeaders: signer })(proposal, endpoint, { taskId, eventId: "event", action: "pay" }, expiry,
    { deadlineMs: Date.now() + 1000 });
  const stopped = expect(attempt).rejects.toThrow("payment request deadline reached");
  await signing; await vi.advanceTimersByTimeAsync(1000); await stopped;
  expect((await db.query("SELECT state,headers FROM store_payments")).rows).toEqual([{ state: "signing", headers: null }]);
  await expect(paid.runner()(proposal, endpoint, { taskId, eventId: "retry", action: "pay" }, expiry)).rejects.toThrow("No second transaction will be signed");
  release(); await vi.advanceTimersByTimeAsync(0);
  expect(signer).toHaveBeenCalledTimes(1); expect(paid.sign).toHaveBeenCalledTimes(1); expect(paid.sent).toHaveLength(0);
  expect((await db.query("SELECT state,headers FROM store_payments")).rows).toEqual([{ state: "signing", headers: null }]);
});
it("provider work receives the remaining budget and cannot release late wallet headers", async () => {
  const expiry = bundle().mandate.expiry; const paid = await payer();
  const payload = JSON.parse(Buffer.from(paid.headers["PAYMENT-SIGNATURE"], "base64").toString());
  let finish!: (value: { transaction: string; nonce: string }) => void;
  const provider = new Promise<{ transaction: string; nonce: string }>((resolve) => { finish = resolve; });
  const factory = vi.fn<NonNullable<Parameters<typeof walletHeaders>[1]>>(() => ({ getAddress: () => guardAddress, buildAndSignPaymentTransaction: () => provider }));
  const createHeaders = walletHeaders(options, factory);
  vi.useFakeTimers();
  const attempt = createHeaders({ x402Version: 2, resource: { url: endpoint }, accepts: [{ ...proposal.requirements,
    network: "cardano:preprod", extra: proposal.requirements.extra! }] }, expiry,
    { deadlineMs: Date.now() + 1500 });
  const stopped = expect(attempt).rejects.toThrow("payment request deadline reached");
  await vi.advanceTimersByTimeAsync(1500); await stopped;
  expect(factory.mock.calls[0][0].provider.requestTimeoutMs).toBe(1500);
  finish(payload.payload); await vi.advanceTimersByTimeAsync(0);
  expect(factory).toHaveBeenCalledTimes(1); expect(paid.sent).toHaveLength(0);
});
it("a slow Blockfrost response cannot start reading its body after the cutoff", async () => {
  const response = Response.json({ hash: "ab".repeat(32), block: "block", block_height: 1 });
  const json = vi.spyOn(response, "json"); let now = Date.now(); const deadlineMs = now + 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const lookup = blockfrostLookup(options, async () => { now = deadlineMs; return response; });
  await expect(lookup("ab".repeat(32), undefined, { deadlineMs })).rejects.toThrow("preprod transaction lookup failed");
  expect(json).not.toHaveBeenCalled();
});
it("a late Blockfrost result cannot start a done write after the recovery deadline", async () => {
  const paid = await payer(); let now = Date.now(); const deadlineMs = now + 1000;
  await db.query("INSERT INTO store_payments(task_id,event_id,state,proposal_digest,headers,tx_hash) VALUES($1,$2,'prepared',$3,$4,$5)",
    [taskId, "event", proposalDigest(proposal), JSON.stringify(paid.headers), paid.txHash]);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const run = paid.runner(undefined, { lookupTransaction: async () => { now = deadlineMs; return true; } });
  await expect(run(proposal, endpoint, { taskId, eventId: "event", action: "pay" }, bundle().mandate.expiry, { deadlineMs, recoveryOnly: true }))
    .rejects.toThrow("payment request deadline reached");
  expect((await db.query("SELECT state,headers FROM store_payments")).rows).toEqual([{ state: "prepared", headers: paid.headers }]);
  expect(paid.sign).not.toHaveBeenCalled(); expect(paid.sent).toHaveLength(0);
});
it("settlement near the recovery cutoff cannot extend the request into its 5 second response reserve", async () => {
  const b = bundle(); const paid = await payer(); let now = Date.now(); const startedAt = now;
  await db.query("INSERT INTO store_payments(task_id,event_id,state,proposal_digest,headers,tx_hash) VALUES($1,$2,'prepared',$3,$4,$5)",
    [taskId, "event-complete", proposalDigest(proposal), JSON.stringify(paid.headers), paid.txHash]);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const delayed: StorePaymentDb = { async query<T>(text: string, params?: unknown[], callOptions?: { deadlineMs?: number }) {
    expect(callOptions?.deadlineMs).toBe(startedAt + 295_000);
    const result = await db.query<T>(text, params);
    if (text === "SELECT state FROM store_payments WHERE task_id=$1") now = startedAt + 289_000;
    if (text.includes("SET state='done'")) now = startedAt + 295_000;
    return result;
  } };
  const pay = vi.fn(paid.runner(delayed, { lookupTransaction: async () => false, fetch: async (url, init) => {
    const response = await paid.paymentFetch(url, init); now = startedAt + 294_000; return response;
  } })).mockImplementationOnce(async () => { now += 195_000; throw new StopError("payment request deadline reached; saved state retained"); });
  const response = await handleStorePay(request(), { env: options, fetch: coreFetch(b), db: delayed, pay });
  expect(response.status).toBe(409); expect(now - startedAt).toBe(295_000); expect(pay).toHaveBeenCalledTimes(2);
  expect(pay.mock.calls[1][4]).toEqual({ recoveryOnly: true, deadlineMs: startedAt + 295_000 });
  expect((await db.query("SELECT state FROM store_payments")).rows).toEqual([{ state: "done" }]);
  expect(paid.sign).not.toHaveBeenCalled(); expect(paid.sent).toHaveLength(1);
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
