import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { ExactCardanoScheme } from "@x402/cardano/exact/client";
import { toClientCardanoSigner, type ClientCardanoSigner } from "@x402/cardano";
import { SlotConfig, Time, Transaction } from "@evolution-sdk/evolution";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { SpendProposalSchema, proposalDigest, type SpendProposal } from "../guard";
import { isPreprodBech32Address } from "../guard/bech32";
import { Journal, StopError, type ActionId } from "./journal";
import { PaymentSchema, type Payment } from "./transcript";
import { inspectHeaders, inspectPayment } from "./transaction";
import { z } from "zod";
import { PaymentBudget } from "./payment-budget";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
const decoder = new x402HTTPClient(new x402Client());
export async function readProposal(response: Response) {
  if (response.status !== 402) throw new StopError("expected PAYMENT-REQUIRED (402)");
  const required = decoder.getPaymentRequiredResponse((name) => response.headers.get(name));
  if (required.x402Version !== 2) throw new StopError("expected x402 v2");
  const proposal = SpendProposalSchema.parse({ kind: "x402", requirements: required.accepts[0] });
  if (proposal.requirements.network !== "cardano:preprod" || proposal.requirements.scheme !== "exact"
    || !isPreprodBech32Address(proposal.requirements.payTo)
    || (proposal.requirements.extra?.assetTransferMethod ?? "default") !== "default") throw new StopError("unsupported preprod payment requirements");
  return { proposal, required };
}

export function approvedHttpClient(approved: PaymentRequirements, signer: ClientCardanoSigner) {
  const digest = proposalDigest(SpendProposalSchema.parse({ kind: "x402", requirements: approved }));
  const client = new x402Client().setSpendControls({ allowedAssets: [{ network: "cardano:preprod",
    asset: approved.asset, maxAmountPerPayment: approved.amount }] })
    // allowedAssets adds to the SDK defaults; this policy restricts to this approval only.
    .registerPolicy((_version, requirements) => requirements.filter((item) =>
      proposalDigest(SpendProposalSchema.parse({ kind: "x402", requirements: item })) === digest))
    .register("cardano:preprod", new ExactCardanoScheme(signer));
  return new x402HTTPClient(client);
}

export function walletHeaders(env: NodeJS.ProcessEnv,
  signerFactory: typeof toClientCardanoSigner = toClientCardanoSigner) {
  // Initialize only after APPROVE and after the fresh requirements check.
  return async (required: PaymentRequired, mandateExpiry: number, options: PaymentCallOptions = {}): Promise<Record<string, string>> => {
    const budget = new PaymentBudget(options.deadlineMs);
    budget.remaining();
    const approved = required.accepts[0];
    if (!env.ORCHESTRATOR_WALLET_MNEMONIC || !env.BLOCKFROST_API_KEY_PREPROD) throw new StopError("preprod wallet configuration missing");
    const signer = signerFactory({ mnemonic: env.ORCHESTRATOR_WALLET_MNEMONIC, network: "cardano:preprod",
      provider: { blockfrost: { baseUrl: "https://cardano-preprod.blockfrost.io/api/v0", projectId: env.BLOCKFROST_API_KEY_PREPROD },
        ...(options.deadlineMs === undefined ? {} : { requestTimeoutMs: Math.min(120_000, budget.remaining()) }) } });
    const http = approvedHttpClient(approved, signer);
    const payload = await budget.run(() => http.createPaymentPayload({ ...required, accepts: [approved] }));
    // Check after all provider/build/sign work, before releasing the signature header.
    inspectPayment(payload, SpendProposalSchema.parse({ kind: "x402", requirements: approved }), mandateExpiry);
    return http.encodePaymentSignatureHeader(payload);
  };
}

export function blockfrostLookup(env: NodeJS.ProcessEnv, fetchTx: Fetch) {
  return async (txHash: string, signal?: AbortSignal, options: PaymentCallOptions = {}): Promise<boolean> => {
    const budget = new PaymentBudget(options.deadlineMs);
    const projectId = env.BLOCKFROST_API_KEY_PREPROD;
    if (!projectId || !/^[0-9a-f]{64}$/.test(txHash)) throw new StopError("preprod transaction lookup configuration missing");
    try {
      const response = await budget.run((requestSignal) => fetchTx(`https://cardano-preprod.blockfrost.io/api/v0/txs/${txHash}`, {
        headers: { project_id: projectId }, redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : []), ...(requestSignal ? [requestSignal] : [])]),
      }));
      signal?.throwIfAborted();
      if (response.status === 404) return false;
      if (!response.ok) throw new Error("lookup failed");
      const tx = z.object({ hash: z.literal(txHash), block: z.string().min(1), block_height: z.number().int().nonnegative(),
        valid_contract: z.boolean().optional() }).parse(await budget.run(() => response.json()));
      signal?.throwIfAborted();
      return tx.valid_contract !== false;
    } catch {
      // Never include provider errors, HTTP bodies or the project key in output.
      throw new StopError("preprod transaction lookup failed; saved signature retained");
    }
  };
}

export type PaymentDeps = {
  fetch: Fetch; createHeaders: (required: PaymentRequired, mandateExpiry: number, options?: PaymentCallOptions) => Promise<Record<string, string>>;
  sleep: (ms: number) => Promise<void>;
  lookupTransaction: (txHash: string, signal?: AbortSignal, options?: PaymentCallOptions) => Promise<boolean>;
  log?: (line: string) => void;
};
export type PaymentCallOptions = { deadlineMs?: number; recoveryOnly?: boolean };
export type PaymentOperation = (proposal: SpendProposal, endpoint: string, id: ActionId, mandateExpiry: number, options?: PaymentCallOptions) => Promise<Payment>;
export type PaymentJournal = {
  get: (id: ActionId) => Promise<Awaited<ReturnType<Journal["get"]>> | undefined>;
  set: Journal["set"];
  // Durable stores atomically reserve the Task before any signer is initialized.
  // Only the successful inserter owns the new signing state.
  claim?: (id: ActionId, digest: string) => Promise<boolean>;
};

// File-backed callers get the CLI's payment checks with a separate journal and injected I/O.
// The whole read/sign/send/save sequence holds the journal lock, including retries.
export function createPaymentRunner(options: { journalPath: string; deps?: PaymentDeps; env?: NodeJS.ProcessEnv }): PaymentOperation {
  const journal = new Journal(options.journalPath);
  const env = options.env ?? process.env;
  const deps = options.deps ?? { fetch, createHeaders: walletHeaders(env),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    lookupTransaction: blockfrostLookup(env, fetch), log: () => {} };
  return (proposal, endpoint, id, mandateExpiry) => journal.withLock(async () => {
    if (id.action !== "pay") throw new StopError("expected a payment action");
    const savedId = await journal.getPaymentId(id.taskId);
    return payApproved(proposal, endpoint, deps, journal, savedId ?? id, mandateExpiry);
  });
}

export async function payApproved(proposal: SpendProposal, endpoint: string, deps: PaymentDeps,
  journal: PaymentJournal, id: ActionId, mandateExpiry: number, options: PaymentCallOptions & { retryPrepared?: boolean } = {}): Promise<Payment> {
  const budget = new PaymentBudget(options.deadlineMs);
  const checkDeadline = () => { budget.remaining(); };
  const requestFetch: Fetch = (url, init) => budget.run((signal) => deps.fetch(url, signal ? { ...init,
    signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) } : init));
  const sleep = (ms: number) => budget.run(() => deps.sleep(Math.min(ms, budget.remaining())));
  const lookupTransaction = (txHash: string) => budget.run((signal) => signal
    ? deps.lookupTransaction(txHash, signal, { deadlineMs: options.deadlineMs }) : deps.lookupTransaction(txHash));
  const save: PaymentJournal["set"] = (actionId, action) => budget.run(() => journal.set(actionId, action));
  checkDeadline();
  const digest = proposalDigest(proposal);
  let saved: Awaited<ReturnType<PaymentJournal["get"]>> | undefined = await budget.run(() => journal.get(id));
  let fresh: Awaited<ReturnType<typeof readProposal>> | undefined;
  if (!saved) {
    if (options.recoveryOnly) throw new StopError("prepared payment unavailable for recovery; no signing");
    if (Math.floor(Date.now() / 1000) + proposal.requirements.maxTimeoutSeconds > mandateExpiry) {
      throw new StopError("Mandate expires before payment deadline; no payment");
    }
    const response = await requestFetch(endpoint, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    fresh = await budget.run(() => readProposal(response));
    if (proposalDigest(fresh.proposal) !== digest) throw new StopError("requirements changed; no payment signed");
    if (journal.claim) {
      checkDeadline();
      // A slow GET must not turn a read-only expiry failure into a signing claim.
      if (Math.floor(Date.now() / 1000) + proposal.requirements.maxTimeoutSeconds > mandateExpiry) {
        throw new StopError("Mandate expires before payment deadline; no payment");
      }
      if (!await budget.run(() => journal.claim!(id, digest))) {
        // Another instance may have paid while this instance checked the seller.
        // Recover its state; never sign or reclaim an ambiguous signing owner.
        saved = await budget.run(() => journal.get(id));
        if (!saved) throw new StopError("durable payment claim unavailable; no signing");
      }
    }
  }
  const resumed = saved?.state === "prepared";
  if (saved?.state === "signing") throw new StopError("payment signing was interrupted; do not build a second transaction");
  if (saved && (saved.endpoint !== endpoint || saved.proposalDigest !== digest)) throw new StopError("saved payment does not match the approved proposal and endpoint");
  if (saved?.state === "done") {
    if (!saved.payment) throw new StopError("saved payment result missing; no second payment");
    return saved.payment;
  }
  if (!saved) {
    if (!fresh) throw new StopError("fresh payment requirements missing; no signing");
    await save(id, { state: "signing", endpoint, proposalDigest: digest });
    const required = { ...fresh.required, accepts: [fresh.required.accepts[0]] };
    const headers = await budget.run(() => options.deadlineMs === undefined ? deps.createHeaders(required, mandateExpiry)
      : deps.createHeaders(required, mandateExpiry, { deadlineMs: options.deadlineMs }));
    const txHash = inspectHeaders(headers, proposal, mandateExpiry);
    saved = { state: "prepared", headers, endpoint, proposalDigest: digest, txHash };
    // Persist before the first possible broadcast. Crash/retry uses these same bytes.
    await save(id, saved);
  }
  if (!saved.headers) throw new StopError("saved payment signature missing");
  // Also check legacy prepared journals, which have no saved txHash.
  const txHash = inspectHeaders(saved.headers, proposal, mandateExpiry);
  if (saved.txHash && saved.txHash !== txHash) throw new StopError("saved transaction hash mismatch");
  if (!saved.txHash) {
    // Only legacy file journals need the hash backfilled. Durable/new prepared
    // records already contain these exact bytes and must not be rewritten.
    saved = { ...saved, txHash };
    await save(id, saved);
  }
  // inspectHeaders has already validated these bytes and required an upper validity bound.
  const signature = new Headers(saved.headers).get("PAYMENT-SIGNATURE")!;
  const payload = decodePaymentSignatureHeader(signature);
  const ttl = Transaction.fromCBORBytes(Buffer.from(payload.payload.transaction as string, "base64")).body.ttl!;
  const deadline = Time.slotToUnixTime(ttl, SlotConfig.getSlotConfig("Preprod")) + 60_000n;
  const log = deps.log ?? console.log;
  const confirmOnChain = async (): Promise<Payment> => {
    const startedAt = Date.now();
    let nextLogAt = startedAt;
    while (true) {
      checkDeadline();
      // Look up even an old prepared transaction once, so a resume can recover it.
      let found = false;
      try { found = await lookupTransaction(txHash); } catch {
        // A provider fault is inconclusive. Keep prepared and retry without exposing its details.
      }
      if (found) {
        const payment: Payment = { txHash, network: "cardano:preprod", status: "confirmed-on-chain" };
        await save(id, { ...saved, state: "done", payment });
        return payment;
      }
      const now = Date.now();
      checkDeadline();
      if (BigInt(now) >= deadline) throw new StopError("transaction expired unsettled; no payment");
      if (now >= nextLogAt) {
        log(`waiting for tx ${txHash} on preprod (${Math.floor((now - startedAt) / 1000)} s)`);
        nextLogAt = now + 15_000;
      }
      await sleep(Number(deadline - BigInt(now) < 5000n ? deadline - BigInt(now) : 5000n));
    }
  };
  if (resumed) {
    checkDeadline();
    // The CLI retains confirmation-only resume. A durable server can also recover
    // a crash after saving prepared bytes but before the first broadcast.
    if (!options.retryPrepared) return confirmOnChain();
    let found = false;
    try { found = await lookupTransaction(txHash); } catch { /* Inconclusive; reuse only these bytes. */ }
    checkDeadline();
    if (found) {
      const payment: Payment = { txHash, network: "cardano:preprod", status: "confirmed-on-chain" };
      await save(id, { ...saved, state: "done", payment });
      return payment;
    }
    // After the signed TTL, only confirmation is useful. Never build a replacement.
    if (BigInt(Date.now()) >= deadline - 60_000n) return confirmOnChain();
  }
  const timeoutAt = Math.min(Date.now() + 300_000, options.deadlineMs ?? Infinity);
  while (Date.now() < timeoutAt) {
    checkDeadline();
    let response: Response;
    try {
      response = await requestFetch(endpoint, { headers: saved.headers, redirect: "error", signal: AbortSignal.timeout(120_000) });
    } catch {
      // An abort or transport error can follow a successful broadcast. Retry only these same bytes.
      await sleep(3000);
      continue;
    }
    let reason = "unknown";
    let payment: Payment | undefined;
    try {
      if (response.headers.has("PAYMENT-RESPONSE")) {
        const settled = decoder.getPaymentSettleResponse((name) => response.headers.get(name));
        reason = settled.errorReason ?? "unknown";
        if (response.ok && settled.success === true && settled.transaction === txHash
          && settled.errorReason !== "settlement_pending" && settled.extra?.status !== "pending") {
          payment = PaymentSchema.parse({ txHash: settled.transaction, network: settled.network, status: settled.extra?.status ?? "confirmed" });
        }
      } else if (response.headers.has("PAYMENT-REQUIRED")) {
        reason = decoder.getPaymentRequiredResponse((name) => response.headers.get(name)).error ?? "unknown";
      }
    } catch {
      reason = "invalid_settle_response";
    }
    if (payment) {
      await save(id, { ...saved, state: "done", payment });
      return payment;
    }
    // Only log the status and a bounded error token, never headers or response bodies.
    const safeReason = typeof reason === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(reason) ? reason : "unknown";
    log(`settle reply: ${response.status} ${safeReason}; waiting for chain`);
    return confirmOnChain();
  }
  return confirmOnChain();
}
