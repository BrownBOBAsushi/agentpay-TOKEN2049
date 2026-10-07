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
  return async (required: PaymentRequired, mandateExpiry: number): Promise<Record<string, string>> => {
    const approved = required.accepts[0];
    if (!env.ORCHESTRATOR_WALLET_MNEMONIC || !env.BLOCKFROST_API_KEY_PREPROD) throw new StopError("preprod wallet configuration missing");
    const signer = signerFactory({ mnemonic: env.ORCHESTRATOR_WALLET_MNEMONIC, network: "cardano:preprod",
      provider: { blockfrost: { baseUrl: "https://cardano-preprod.blockfrost.io/api/v0", projectId: env.BLOCKFROST_API_KEY_PREPROD } } });
    const http = approvedHttpClient(approved, signer);
    const payload = await http.createPaymentPayload({ ...required, accepts: [approved] });
    // Check after all provider/build/sign work, before releasing the signature header.
    inspectPayment(payload, SpendProposalSchema.parse({ kind: "x402", requirements: approved }), mandateExpiry);
    return http.encodePaymentSignatureHeader(payload);
  };
}

export function blockfrostLookup(env: NodeJS.ProcessEnv, fetchTx: Fetch) {
  return async (txHash: string): Promise<boolean> => {
    if (!env.BLOCKFROST_API_KEY_PREPROD || !/^[0-9a-f]{64}$/.test(txHash)) throw new StopError("preprod transaction lookup configuration missing");
    try {
      const response = await fetchTx(`https://cardano-preprod.blockfrost.io/api/v0/txs/${txHash}`, {
        headers: { project_id: env.BLOCKFROST_API_KEY_PREPROD }, redirect: "error", signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 404) return false;
      if (!response.ok) throw new Error("lookup failed");
      const tx = z.object({ hash: z.literal(txHash), block: z.string().min(1), block_height: z.number().int().nonnegative(),
        valid_contract: z.boolean().optional() }).parse(await response.json());
      return tx.valid_contract !== false;
    } catch {
      // Never include provider errors, HTTP bodies or the project key in output.
      throw new StopError("preprod transaction lookup failed; saved signature retained");
    }
  };
}

export async function payApproved(proposal: SpendProposal, endpoint: string, deps: {
  fetch: Fetch; createHeaders: (required: PaymentRequired, mandateExpiry: number) => Promise<Record<string, string>>;
  sleep: (ms: number) => Promise<void>;
  lookupTransaction: (txHash: string) => Promise<boolean>;
  log?: (line: string) => void;
}, journal: Journal, id: ActionId, mandateExpiry: number): Promise<Payment> {
  let saved = await journal.get(id);
  const resumed = saved?.state === "prepared";
  if (saved?.state === "signing") throw new StopError("payment signing was interrupted; do not build a second transaction");
  const digest = proposalDigest(proposal);
  if (saved && (saved.endpoint !== endpoint || saved.proposalDigest !== digest)) throw new StopError("saved payment does not match the approved proposal and endpoint");
  if (saved?.state === "done") {
    if (!saved.payment) throw new StopError("saved payment result missing; no second payment");
    return saved.payment;
  }
  if (!saved) {
    if (Math.floor(Date.now() / 1000) + proposal.requirements.maxTimeoutSeconds > mandateExpiry) {
      throw new StopError("Mandate expires before payment deadline; no payment");
    }
    const fresh = await readProposal(await deps.fetch(endpoint, { redirect: "error", signal: AbortSignal.timeout(30_000) }));
    if (proposalDigest(fresh.proposal) !== proposalDigest(proposal)) throw new StopError("requirements changed; no payment signed");
    await journal.set(id, { state: "signing", endpoint, proposalDigest: digest });
    const headers = await deps.createHeaders({ ...fresh.required, accepts: [fresh.required.accepts[0]] }, mandateExpiry);
    const txHash = inspectHeaders(headers, proposal, mandateExpiry);
    saved = { state: "prepared", headers, endpoint, proposalDigest: digest, txHash };
    // Persist before the first possible broadcast. Crash/retry uses these same bytes.
    await journal.set(id, saved);
  }
  if (!saved.headers) throw new StopError("saved payment signature missing");
  // Also check legacy prepared journals, which have no saved txHash.
  const txHash = inspectHeaders(saved.headers, proposal, mandateExpiry);
  if (saved.txHash && saved.txHash !== txHash) throw new StopError("saved transaction hash mismatch");
  saved = { ...saved, txHash };
  await journal.set(id, saved);
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
      // Look up even an old prepared transaction once, so a resume can recover it.
      let found = false;
      try { found = await deps.lookupTransaction(txHash); } catch {
        // A provider fault is inconclusive. Keep prepared and retry without exposing its details.
      }
      if (found) {
        const payment: Payment = { txHash, network: "cardano:preprod", status: "confirmed-on-chain" };
        await journal.set(id, { ...saved, state: "done", payment });
        return payment;
      }
      const now = Date.now();
      if (BigInt(now) >= deadline) throw new StopError("transaction expired unsettled; no payment");
      if (now >= nextLogAt) {
        log(`waiting for tx ${txHash} on preprod (${Math.floor((now - startedAt) / 1000)} s)`);
        nextLogAt = now + 15_000;
      }
      await deps.sleep(Number(deadline - BigInt(now) < 5000n ? deadline - BigInt(now) : 5000n));
    }
  };
  if (resumed) return confirmOnChain();
  const timeoutAt = Date.now() + 300_000;
  while (Date.now() < timeoutAt) {
    let response: Response;
    try {
      response = await deps.fetch(endpoint, { headers: saved.headers, redirect: "error", signal: AbortSignal.timeout(120_000) });
    } catch {
      // An abort or transport error can follow a successful broadcast. Retry only these same bytes.
      await deps.sleep(3000);
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
      await journal.set(id, { ...saved, state: "done", payment });
      return payment;
    }
    // Only log the status and a bounded error token, never headers or response bodies.
    const safeReason = typeof reason === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(reason) ? reason : "unknown";
    log(`settle reply: ${response.status} ${safeReason}; waiting for chain`);
    return confirmOnChain();
  }
  return confirmOnChain();
}
