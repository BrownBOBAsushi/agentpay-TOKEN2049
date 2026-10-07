import { PGlite } from "@electric-sql/pglite";
import { Address, CBOR, COSE, KeyHash, PrivateKey, SlotConfig, Time, Transaction, TransactionBody, TransactionHash } from "@evolution-sdk/evolution";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { jcs, mandateDigest, proposalDigest, signReceipt, type MandateBundle, type SpendProposal } from "../guard";
import { createDevMandate } from "../orchestrator/mandate";
import type { PaymentDeps } from "../orchestrator/payment";
import type { Db } from "../worker/db";
import { createStorePaymentRunner } from "./store-payment-db.server";
import { createLatteHandler } from "./store-seller.server";
import { handleStorePay } from "./store-payment.server";
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
beforeEach(async () => { await db.query("TRUNCATE store_payments"); });
afterAll(async () => { await database?.close(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
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
  return { pay: runner(), runner, sign, sent, txHash, headers };
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
  expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
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
