import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { CoreClient, CoreTask } from "./core";
import { WorkerError } from "./errors";
import { runGuardTask } from "./guard-task";
import type { GuardTaskInput } from "./guard-task";
import type { MpsClient, PaymentRequest } from "./mps";

export type PaidTerms = { agentIdentifier: string; supportedPaymentSourceIndex: number; tusdmUnit: string;
  deadlines?: { payBy: number; submitResult: number; unlock: number; dispute: number } };
type PaidState = {
  description: string; request?: PaymentRequest; payment?: unknown;
  result?: string; resultHash?: string; settlement?: { settled: boolean; txHash?: string | null }; failure?: string;
};
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const dateValue = z.union([z.string().min(1), z.number().finite()]);
const paymentSchema = z.object({
  blockchainIdentifier: z.string().min(1), agentIdentifier: z.string().min(1), inputHash: z.string(), identifierFromPurchaser: z.string().optional(),
  payByTime: dateValue, submitResultTime: dateValue, unlockTime: dateValue, externalDisputeUnlockTime: dateValue,
  sellerReturnAddress: z.null(), forceLayer: z.null().optional(),
  RequestedFunds: z.array(z.object({ amount: z.string(), unit: z.string() })).length(1),
  PaymentSource: z.object({ network: z.literal("Preprod"), paymentSourceType: z.literal("Web3CardanoV2"), smartContractAddress: z.string().min(1), policyId: z.string().min(1) }),
  SmartContractWallet: z.object({ walletVkey: z.string().min(1) }),
});

function deadline(value: string | number): number {
  const millis = typeof value === "number" || /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  if (!Number.isSafeInteger(millis) || millis < 0) throw new WorkerError("Invalid MPS payment deadline");
  return millis;
}

function purchasePayload(raw: unknown, request: PaymentRequest) {
  const parsed = paymentSchema.safeParse(raw);
  if (!parsed.success) throw new WorkerError("Invalid MPS signed payment");
  const p = parsed.data;
  if (p.RequestedFunds[0].amount !== "1000000" || p.RequestedFunds[0].unit !== request.RequestedFunds[0].unit
    || p.agentIdentifier !== request.agentIdentifier || p.inputHash !== request.inputHash
    || (p.identifierFromPurchaser !== undefined && p.identifierFromPurchaser !== request.identifierFromPurchaser)) {
    throw new WorkerError("MPS signed payment differs from request");
  }
  for (const field of ["payByTime", "submitResultTime", "unlockTime", "externalDisputeUnlockTime"] as const) {
    if (deadline(p[field]) !== deadline(request[field])) throw new WorkerError("MPS signed deadline differs from request");
  }
  return {
    blockchainIdentifier: p.blockchainIdentifier, agentIdentifier: p.agentIdentifier, sellerVkey: p.SmartContractWallet.walletVkey,
    submitResultTime: p.submitResultTime, payByTime: p.payByTime, unlockTime: p.unlockTime, externalDisputeUnlockTime: p.externalDisputeUnlockTime,
    inputHash: p.inputHash, identifierFromPurchaser: request.identifierFromPurchaser,
    paymentSourceType: "Web3CardanoV2", supportedPaymentSourceIndex: request.supportedPaymentSourceIndex,
    Amounts: p.RequestedFunds, PaymentSource: { network: "Preprod", smartContractAddress: p.PaymentSource.smartContractAddress, policyId: p.PaymentSource.policyId },
  };
}

const transactionSchema = z.object({ status: z.string(), newOnChainState: z.string() });
function resolveState(raw: unknown) {
  const parsed = z.object({ onChainState: z.string().nullable(), resultHash: z.string().nullable().optional(),
    CurrentTransaction: transactionSchema.nullable().optional(), TransactionHistory: z.array(transactionSchema).optional() }).safeParse(raw);
  if (!parsed.success) throw new WorkerError("Invalid MPS state response");
  return parsed.data;
}
function confirmed(p: ReturnType<typeof resolveState>, state: string, resultHash?: string): boolean {
  return p.onChainState === state && (resultHash === undefined || p.resultHash === resultHash)
    && [p.CurrentTransaction, ...(p.TransactionHistory ?? [])].some((tx) => tx?.status === "Confirmed" && tx.newOnChainState === state);
}

export async function advancePaidTask(input: {
  task: CoreTask; core: CoreClient; mps: MpsClient; store: GuardTaskInput["store"];
  guardKey: GuardTaskInput["guardKey"]; paid: PaidTerms; nowSec: number; log?: (stage: string, taskId: string) => void;
}): Promise<void> {
  const { task, store, core, mps, nowSec } = input;
  if (!Number.isSafeInteger(nowSec) || nowSec < 0) throw new WorkerError("Invalid paid Task time");
  const log = (stage: string) => input.log?.(stage, task.id);
  let journal = await store.readJournal<PaidState>(task.id);
  if (!journal) {
    if (task.status !== "READY") { log("unowned"); return; }
    await store.createJournal(task.id, "start", { description: task.description ?? "" }, "paid");
    journal = await store.readJournal<PaidState>(task.id);
  }
  if (!journal || journal.mode !== "paid") throw new WorkerError("Task does not belong to paid flow");
  if (["settled", "failed"].includes(journal.stage)) return;
  const data = journal.data;
  const save = async (stage: string, changes: Partial<PaidState> = {}) => {
    await store.writeJournal(task.id, stage, { ...data, ...changes }, "paid"); log(stage);
  };
  const fail = async (reason: string) => { await save("failed", { failure: reason }); log(reason); };
  const key = (action: string) => ({ taskId: task.id, eventId: "-", action });
  if (journal.stage === "start") {
    await store.once(key("start"), async () => { await core.postEvent(task.id, { status: "RUNNING" }); return null; });
    const iso = (minutes: number) => new Date((nowSec + minutes * 60) * 1000).toISOString();
    const offsets = input.paid.deadlines ?? { payBy: 20, submitResult: 60, unlock: 75, dispute: 90 };
    const request: PaymentRequest = {
      network: "Preprod", agentIdentifier: input.paid.agentIdentifier, paymentSourceType: "Web3CardanoV2",
      supportedPaymentSourceIndex: input.paid.supportedPaymentSourceIndex, inputHash: hash(data.description),
      identifierFromPurchaser: randomBytes(10).toString("hex"), RequestedFunds: [{ amount: "1000000", unit: input.paid.tusdmUnit }],
      payByTime: iso(offsets.payBy), submitResultTime: iso(offsets.submitResult), unlockTime: iso(offsets.unlock), externalDisputeUnlockTime: iso(offsets.dispute), metadata: JSON.stringify({ taskId: task.id }),
    };
    await save("terms", { request }); return;
  }
  if (!data.request) throw new WorkerError("Missing saved MPS request");
  if (journal.stage === "terms") {
    const payment = await store.once(key("terms"), () => mps.createPayment(data.request!));
    await save("masumi-payment", { payment }); return;
  }
  const payload = purchasePayload(data.payment, data.request);
  if (journal.stage === "masumi-payment") {
    if (nowSec * 1000 >= deadline(payload.payByTime)) { await fail("payment_deadline_expired"); return; }
    await store.once(key("masumi-payment"), async () => { await core.postEvent(task.id, { comment: "Payment requested: 1 test USDM.", masumiPayment: payload }); return null; });
    await save("await-escrow"); return;
  }
  if (journal.stage === "await-escrow") {
    const state = resolveState(await mps.resolve(payload.blockchainIdentifier));
    if (state.onChainState && ["FundsOrDatumInvalid", "Withdrawn", "RefundWithdrawn", "DisputedWithdrawn"].includes(state.onChainState)) {
      await fail(state.onChainState); return;
    }
    if (state.onChainState === null && nowSec * 1000 >= deadline(payload.payByTime) + 600_000) {
      await fail("payment_deadline_expired"); return;
    }
    if (confirmed(state, "FundsLocked")) await save("check");
    return;
  }
  if (journal.stage === "check") {
    if (nowSec * 1000 >= deadline(payload.submitResultTime)) { await fail("result_deadline_expired"); return; }
    const result = await store.once(key("check"), () => runGuardTask({ taskId: task.id, description: data.description, nowSec, store, guardKey: input.guardKey }));
    await save("submit-result", { result, resultHash: hash(result) }); return;
  }
  if (typeof data.result !== "string" || data.resultHash !== hash(data.result)) throw new WorkerError("Missing or invalid saved result");
  if (journal.stage === "submit-result") {
    if (nowSec * 1000 >= deadline(payload.submitResultTime)) { await fail("result_deadline_expired"); return; }
    await store.once(key("submit-result"), async () => { await mps.submitResult(payload.blockchainIdentifier, data.resultHash!); return null; });
    await save("await-result"); return;
  }
  if (journal.stage === "await-result") {
    if (confirmed(resolveState(await mps.resolve(payload.blockchainIdentifier)), "ResultSubmitted", data.resultHash)) await save("complete");
    return;
  }
  if (journal.stage === "complete") {
    await store.once(key("complete"), async () => { await core.postEvent(task.id, { status: "COMPLETED", comment: data.result }); return null; });
    await save("await-settlement"); return;
  }
  if (journal.stage === "await-settlement") {
    const settlement = await core.receipt(task.id);
    if (settlement.settled && !settlement.txHash) throw new WorkerError("Settled Core receipt has no transaction hash");
    await save(settlement.settled ? "settled" : "await-settlement", { settlement }); return;
  }
  throw new WorkerError("Unknown paid Task journal stage");
}
