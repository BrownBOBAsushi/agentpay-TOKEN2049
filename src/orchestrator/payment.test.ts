import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Address, CBOR, Transaction, TransactionBody, TransactionHash } from "@evolution-sdk/evolution";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { afterEach, expect, it, vi } from "vitest";
import { proposalDigest, type SpendProposal } from "../guard";
import { Journal } from "./journal";
import { blockfrostLookup, payApproved, walletHeaders, type Fetch } from "./payment";
import { inspectPayment } from "./transaction";

const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
const endpoint = "http://seller/api/market-data";
const payTo = Address.toBech32(Address.fromHex(`60${"11".repeat(28)}`));
const proposal: SpendProposal = { kind: "x402", requirements: { scheme: "exact", network: "cardano:preprod",
  asset: "lovelace", amount: "2000000", payTo, maxTimeoutSeconds: 600, extra: { assetTransferMethod: "default" } } };
const required: PaymentRequired = { x402Version: 2, resource: { url: endpoint },
  accepts: [{ ...proposal.requirements, network: "cardano:preprod", extra: proposal.requirements.extra! }] };
const id = { taskId: "task", eventId: "complete", action: "pay" as const };
const expiry = 1700000610;
// Synthetic CBOR for offline signer tests. It is not a ledger-valid payment.
function signedHeaders(ttl: bigint | null = 44317400n) {
  const body = new Map<CBOR.CBOR, CBOR.CBOR>([[0n, []], [1n, []], [2n, 170000n]]);
  if (ttl !== null) body.set(3n, ttl);
  const bytes = CBOR.toCBORBytes([body, new Map(), true, null]);
  const txHash = TransactionHash.toHex(TransactionBody.toHashFromBytes(Transaction.extractBodyBytes(bytes)));
  const payload = { x402Version: 2, resource: required.resource, accepted: required.accepts[0],
    payload: { transaction: Buffer.from(bytes).toString("base64"), nonce: `${"ab".repeat(32)}#0` } };
  return { headers: { "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payload) }, txHash, transaction: payload.payload.transaction };
}
function unpaid(error?: string) {
  return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ ...required, error })).toString("base64") } });
}
function settled(txHash: string) {
  // extra is optional in the installed SettleResponse type.
  return new Response("{}", { headers: { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify({ success: true,
    network: "cardano:preprod", transaction: txHash })).toString("base64") } });
}
async function journal() {
  const dir = await mkdtemp(join(tmpdir(), "agentpay-round2-")); dirs.push(dir);
  return new Journal(join(dir, "journal.json"));
}

it("rejects a delayed fresh fetch and signer whose built TTL exceeds the absolute Mandate expiry", async () => {
  let clock = 1700000000000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  const saved = await journal();
  const fetchPaid = vi.fn(async () => { clock += 20_000; return unpaid(); });
  const createHeaders = vi.fn(async () => signedHeaders(44317420n).headers);
  await expect(payApproved(proposal, endpoint, { fetch: fetchPaid, createHeaders, sleep: async () => {},
    lookupTransaction: async () => false }, saved, id, expiry)).rejects.toThrow("TTL exceeds Mandate expiry");
  expect(createHeaders).toHaveBeenCalledWith(required, expiry);
  expect(fetchPaid).toHaveBeenCalledTimes(1);
  expect((await saved.get(id))?.headers).toBeUndefined();
});
it.each([44317410n, 44317409n])("allows a built TTL at or below the expiry (%s)", async (ttl) => {
  vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  const signed = signedHeaders(ttl); const saved = await journal();
  const payment = await payApproved(proposal, endpoint, { fetch: async (_url, init) => init?.headers ? settled(signed.txHash) : unpaid(),
    createHeaders: async () => signed.headers, sleep: async () => {}, lookupTransaction: async () => false }, saved, id, expiry);
  expect(payment).toEqual({ txHash: signed.txHash, network: "cardano:preprod", status: "confirmed" });
});
it("rejects a transaction without an upper validity bound", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  const saved = await journal(); const fetchPaid = vi.fn(async () => unpaid());
  await expect(payApproved(proposal, endpoint, { fetch: fetchPaid, createHeaders: async () => signedHeaders(null).headers,
    sleep: async () => {}, lookupTransaction: async () => false }, saved, id, expiry)).rejects.toThrow("TTL missing");
  expect(fetchPaid).toHaveBeenCalledTimes(1);
});
it("does not release wallet headers after provider work makes the built TTL too late", async () => {
  const signed = signedHeaders(44317420n);
  const createHeaders = walletHeaders({ NODE_ENV: "test", ORCHESTRATOR_WALLET_MNEMONIC: "public-test-placeholder", BLOCKFROST_API_KEY_PREPROD: "test-key" },
    () => ({ getAddress: () => payTo, buildAndSignPaymentTransaction: async () => ({ transaction: signed.transaction, nonce: `${"ab".repeat(32)}#0` }) }));
  await expect(createHeaders(required, expiry)).rejects.toThrow("TTL exceeds Mandate expiry");
});
it("retries an aborted paid request with the same saved signature and at least a 120 second request timeout", async () => {
  let clock = 1700000000000; vi.spyOn(Date, "now").mockImplementation(() => clock);
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const signed = signedHeaders(); const saved = await journal(); const sent: string[] = [];
  const sign = vi.fn(async () => signed.headers);
  const payment = await payApproved(proposal, endpoint, { fetch: async (_url, init) => {
    const signature = new Headers(init?.headers).get("PAYMENT-SIGNATURE");
    if (!signature) return unpaid();
    sent.push(signature);
    if (sent.length === 1) { clock += 120_000; throw new DOMException("timed out", "TimeoutError"); }
    return settled(signed.txHash);
  }, createHeaders: sign, sleep: async (ms) => { clock += ms; }, lookupTransaction: async () => false }, saved, id, expiry);
  expect(payment.txHash).toBe(signed.txHash); expect(sign).toHaveBeenCalledTimes(1);
  expect(sent).toEqual([signed.headers["PAYMENT-SIGNATURE"], signed.headers["PAYMENT-SIGNATURE"]]);
  expect(timeout).toHaveBeenCalledWith(120_000);
  expect((await saved.get(id))?.state).toBe("done");
});
it.each([true, false])("resolves nonce_not_on_chain only when preprod lookup finds the saved tx (%s)", async (found) => {
  let clock = 1700000000000; vi.spyOn(Date, "now").mockImplementation(() => clock);
  const signed = signedHeaders(); const saved = await journal(); const sign = vi.fn(async () => signed.headers);
  const lookupTransaction = vi.fn(async () => found);
  const operation = payApproved(proposal, endpoint, { fetch: async (_url, init) => init?.headers
    ? unpaid("invalid_exact_cardano_payload_nonce_not_on_chain") : unpaid(), createHeaders: sign,
    sleep: async (ms) => { clock += ms; }, lookupTransaction }, saved, id, expiry);
  if (found) {
    await expect(operation).resolves.toEqual({ txHash: signed.txHash, network: "cardano:preprod", status: "confirmed-on-chain" });
    expect((await saved.get(id))?.state).toBe("done");
  } else {
    await expect(operation).rejects.toThrow("transaction expired unsettled; no payment");
    expect((await saved.get(id))?.state).toBe("prepared");
  }
  expect(lookupTransaction).toHaveBeenCalledWith(signed.txHash); expect(sign).toHaveBeenCalledTimes(1);
});
it.each([true, false])("looks up a legacy prepared signature on resume without a new tx (%s)", async (found) => {
  const signed = signedHeaders(); const saved = await journal();
  await saved.set(id, { state: "prepared", headers: signed.headers, endpoint, proposalDigest: proposalDigest(proposal) });
  const fetchPaid = vi.fn(async () => unpaid()); const sign = vi.fn(async () => signed.headers);
  const lookupTransaction = vi.fn(async () => found);
  const operation = payApproved(proposal, endpoint, { fetch: fetchPaid, createHeaders: sign, sleep: async () => {}, lookupTransaction }, saved, id, expiry);
  if (found) {
    await expect(operation).resolves.toMatchObject({ txHash: signed.txHash, status: "confirmed-on-chain" });
    expect((await saved.get(id))?.state).toBe("done");
  } else {
    await expect(operation).rejects.toThrow("transaction expired unsettled; no payment");
    expect((await saved.get(id))?.state).toBe("prepared");
  }
  expect(fetchPaid).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled();
  expect(lookupTransaction).toHaveBeenCalledWith(signed.txHash);
});
it.each(["required", "settle", "plain", "malformed", "untrusted-success", "unsafe-reason"])("polls after an unconfirmed %s reply and finds the tx on the third lookup", async (kind) => {
  let clock = 1700000000000; vi.spyOn(Date, "now").mockImplementation(() => clock);
  const signed = signedHeaders(); const saved = await journal(); const logs: string[] = [];
  const sign = vi.fn(async () => signed.headers);
  const fetchPaid = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.headers) return unpaid();
    clock += 620_000; // Reply arrives after TTL; the indexing grace must still permit recovery.
    if (kind === "required") return unpaid("nonce_not_on_chain");
    if (kind === "unsafe-reason") return unpaid("failure\nprivate-error-detail");
    if (kind === "plain") return new Response("private-response-body", { status: 503 });
    if (kind === "untrusted-success") return settled("cd".repeat(32));
    return new Response("private-response-body", { status: 402, headers: { "PAYMENT-RESPONSE": kind === "malformed" ? "invalid"
      : Buffer.from(JSON.stringify({ success: false, errorReason: "settlement_failed", network: "cardano:preprod", transaction: signed.txHash })).toString("base64") } });
  });
  const lookupTransaction = vi.fn(async () => lookupTransaction.mock.calls.length === 3);
  const sleep = vi.fn(async (ms: number) => { clock += ms; });
  const payment = await payApproved(proposal, endpoint, { fetch: fetchPaid, createHeaders: sign, sleep, lookupTransaction,
    log: (line) => logs.push(line) }, saved, id, expiry);
  expect(payment).toEqual({ txHash: signed.txHash, network: "cardano:preprod", status: "confirmed-on-chain" });
  expect((await saved.get(id))?.state).toBe("done"); expect(sign).toHaveBeenCalledTimes(1);
  expect(fetchPaid).toHaveBeenCalledTimes(2); expect(lookupTransaction.mock.calls).toEqual(Array(3).fill([signed.txHash]));
  expect(sleep.mock.calls).toEqual([[5000], [5000]]);
  expect(logs[0]).toBe(`settle reply: ${kind === "plain" ? "503 unknown" : kind === "untrusted-success" ? "200 unknown"
    : kind === "unsafe-reason" ? "402 unknown" : kind === "required" ? "402 nonce_not_on_chain"
    : kind === "malformed" ? "402 invalid_settle_response" : "402 settlement_failed"}; waiting for chain`);
  expect(JSON.stringify(logs)).not.toContain("private-response-body");
  expect(JSON.stringify(logs)).not.toContain("private-error-detail");
  expect(JSON.stringify(logs)).not.toContain(signed.headers["PAYMENT-SIGNATURE"]);
});
it("polls a prepared transaction on resume without signing or sending to the seller", async () => {
  let clock = 1700000000000; vi.spyOn(Date, "now").mockImplementation(() => clock);
  const signed = signedHeaders(); const saved = await journal();
  await saved.set(id, { state: "prepared", headers: signed.headers, endpoint, proposalDigest: proposalDigest(proposal), txHash: signed.txHash });
  const fetchPaid = vi.fn(async () => unpaid()); const sign = vi.fn(async () => signed.headers);
  const lookupTransaction = vi.fn(async () => lookupTransaction.mock.calls.length === 3);
  await expect(payApproved(proposal, endpoint, { fetch: fetchPaid, createHeaders: sign,
    sleep: async (ms) => { clock += ms; }, lookupTransaction, log: () => {} }, saved, id, expiry))
    .resolves.toMatchObject({ txHash: signed.txHash, status: "confirmed-on-chain" });
  expect(lookupTransaction).toHaveBeenCalledTimes(3); expect((await saved.get(id))?.state).toBe("done");
  expect(fetchPaid).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled();
});
it("waits through the signed TTL plus 60 seconds, then stops and keeps the prepared signature", async () => {
  let clock = 1700000000000; vi.spyOn(Date, "now").mockImplementation(() => clock);
  const signed = signedHeaders(); const saved = await journal(); const logs: string[] = [];
  const sign = vi.fn(async () => signed.headers);
  const fetchPaid = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.headers) return unpaid();
    clock += 620_000; return unpaid("settlement_failed");
  });
  const lookupTransaction = vi.fn(async () => false);
  const sleep = vi.fn(async (ms: number) => { clock += ms; });
  await expect(payApproved(proposal, endpoint, { fetch: fetchPaid, createHeaders: sign, sleep, lookupTransaction,
    log: (line) => logs.push(line) }, saved, id, expiry)).rejects.toThrow("transaction expired unsettled; no payment");
  expect(clock).toBe(1700000660000); // Actual TTL is 600 s; Mandate expires at 610 s.
  expect(lookupTransaction).toHaveBeenCalledTimes(9); expect(sleep.mock.calls).toEqual(Array(8).fill([5000]));
  expect(fetchPaid).toHaveBeenCalledTimes(2); expect(sign).toHaveBeenCalledTimes(1);
  expect(await saved.get(id)).toMatchObject({ state: "prepared", headers: signed.headers, txHash: signed.txHash });
  expect(logs).toEqual(["settle reply: 402 settlement_failed; waiting for chain",
    ...[0, 15, 30].map((seconds) => `waiting for tx ${signed.txHash} on preprod (${seconds} s)`)]);
});
it.each([200, 404, 401])("queries only Blockfrost preprod with an injected fetch (%s)", async (status) => {
  const signed = signedHeaders(); const fetchTx = vi.fn<Fetch>(async () => new Response(JSON.stringify({ hash: signed.txHash,
    block: "cd".repeat(32), block_height: 123, valid_contract: true }), { status }));
  const lookup = blockfrostLookup({ NODE_ENV: "test", BLOCKFROST_API_KEY_PREPROD: "test-key" }, fetchTx);
  if (status === 401) await expect(lookup(signed.txHash)).rejects.toThrow("preprod transaction lookup failed");
  else await expect(lookup(signed.txHash)).resolves.toBe(status === 200);
  expect(fetchTx.mock.calls[0][0]).toBe(`https://cardano-preprod.blockfrost.io/api/v0/txs/${signed.txHash}`);
  expect(new Headers(fetchTx.mock.calls[0][1]?.headers).get("project_id")).toBe("test-key");
});
it.each(["a0", "bfff"])("hashes the original body, independent of witness encoding (%s)", (witness) => {
  // Non-canonical body key order. Expected BLAKE2b-256 computed separately with Python hashlib.
  const transaction = Buffer.from(`84a4031a02a43ad8021a0002981001800080${witness}f5f6`, "hex").toString("base64");
  expect(inspectPayment({ x402Version: 2, accepted: required.accepts[0], payload: { transaction } }, proposal, expiry))
    .toBe("9a5f66e2bd1ee36c7dba0247dac29c89ee14bd0875a27a0bcf4eb636cdd3fcc7");
});
it("does not count an included phase-2-invalid transaction as paid", async () => {
  const signed = signedHeaders();
  const lookup = blockfrostLookup({ NODE_ENV: "test", BLOCKFROST_API_KEY_PREPROD: "test-key" }, async () =>
    new Response(JSON.stringify({ hash: signed.txHash, block: "cd".repeat(32), block_height: 123, valid_contract: false })));
  await expect(lookup(signed.txHash)).resolves.toBe(false);
});
