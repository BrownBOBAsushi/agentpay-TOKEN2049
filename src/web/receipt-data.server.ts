import "server-only";
import { cache } from "react";
import { z } from "zod";
import example from "../../public/examples/guard-receipt-refuse.json";
import { createCoreClient } from "../worker/core";
import { SafeToRetryError } from "../worker/store";
import { MandateBundleSchema } from "../guard/bundle";
import { SpendProposalSchema } from "../guard/proposal";
import { mandateDigest } from "../guard/digest";
import { proposalDigest, receiptDigest, verifyReceipt } from "../guard/receipt";
import type { GuardReceipt } from "../guard/receipt";
import type { ReceiptPageData, ReceiptRecord } from "./receipt-types";

const diffSchema = z.object({ field: z.string(), signed: z.string(), proposed: z.string() });
const signedSchema = z.object({
  receipt: z.object({ v: z.literal(1), verdict: z.enum(["APPROVE", "REFUSE"]), reasons: z.array(z.string()),
    diff: z.array(diffSchema), taskId: z.string().min(1), ts: z.number().int().nonnegative().max(8_640_000_000_000),
    mandateDigest: z.string().regex(/^[0-9a-f]{64}$/i), proposalDigest: z.string().regex(/^[0-9a-f]{64}$/i) }),
  coseSign1: z.string(), coseKey: z.string(), guardAddress: z.string(), digest: z.string(),
});
const eventSchema = z.object({ status: z.string().nullish(), comment: z.string().nullish(),
  createdAt: z.string().optional(), masumiPayment: z.unknown().optional() });
const eventPageSchema = z.object({ data: z.array(eventSchema),
  meta: z.object({ pagination: z.object({ nextCursor: z.string().nullish() }).optional() }).optional() });
const anchorSchema = z.object({ data: z.object({ onChainState: z.string().nullish(), settled: z.boolean(),
  txHash: z.string().regex(/^[0-9a-f]{64}$/i).nullish() }).nullable() });
const notFound = (error: unknown) => error instanceof SafeToRetryError && error.message === "Core GET HTTP 404";

function exampleRecord(): ReceiptRecord {
  return { kind: "receipt", example: true, taskId: "example", ts: null, verdict: "REFUSE", reasons: example.reasons,
    diff: example.diff, matching: [], signatureValid: false, guardAddress: null,
    digests: { receipt: null, mandate: null, proposal: null }, bundle: null, proposal: null,
    inputs: "unavailable", anchor: { kind: "example" } };
}

export async function loadReceipt(id: string, options: {
  origin?: string; apiKey?: string; guardAddress?: string; fetch: typeof fetch;
}): Promise<ReceiptPageData> {
  if (id === "example") return exampleRecord();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return { kind: "not-found" };
  if (!options.origin || !options.apiKey || !options.guardAddress) return { kind: "unreachable" };
  try {
    const core = createCoreClient({ origin: options.origin, apiKey: options.apiKey,
      fetch: (input, init) => options.fetch(input, { ...init, cache: "no-store" }) });
    let task;
    try { task = await core.getTask(id); }
    catch (error) { if (notFound(error)) return { kind: "not-found" }; throw error; }
    if (task.id !== id) return { kind: "unreachable" };
    if (task.status !== "COMPLETED") return { kind: "in-progress", status: task.status };
    const events: z.infer<typeof eventSchema>[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= 100) return { kind: "unreachable" };
      const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
      const result = eventPageSchema.parse(await core.request(`/v1/tasks/${encodeURIComponent(id)}/events${query}`));
      events.push(...result.data);
      cursor = result.meta?.pagination?.nextCursor ?? undefined;
      if (!cursor) break;
      if (seen.has(cursor)) return { kind: "unreachable" };
      seen.add(cursor);
    }
    const completed = events.filter((event) => event.status === "COMPLETED")
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
    let raw: unknown;
    try { raw = JSON.parse(completed?.comment ?? ""); } catch { return { kind: "not-receipt" }; }
    const parsed = signedSchema.safeParse(raw);
    if (!parsed.success) return { kind: "not-receipt" };
    const signed = parsed.data;
    const signatureValid = verifyReceipt(raw, options.guardAddress) && signed.receipt.taskId === id;
    let bundle: ReceiptRecord["bundle"] = null;
    let proposal: ReceiptRecord["proposal"] = null;
    let inputs: ReceiptRecord["inputs"] = "unavailable";
    try {
      const description = z.object({ mandateBundle: MandateBundleSchema, proposal: SpendProposalSchema }).parse(JSON.parse(task.description ?? ""));
      if (mandateDigest(description.mandateBundle.mandate) === signed.receipt.mandateDigest
        && proposalDigest(description.proposal) === signed.receipt.proposalDigest) {
        bundle = description.mandateBundle; proposal = description.proposal; inputs = "available";
      } else { inputs = "digest-mismatch"; }
    } catch { /* Unavailable input must not be filled from another Task or fixture. */ }
    const paid = events.some((event) => event.masumiPayment != null);
    let settlement: z.infer<typeof anchorSchema>["data"];
    try { settlement = anchorSchema.parse(await core.request(`/v1/tasks/${encodeURIComponent(id)}/receipt`)).data; }
    catch (error) { if (!paid && notFound(error)) settlement = null; else throw error; }
    const matching = bundle && proposal ? [
      { field: "network", signed: bundle.mandate.network, proposed: proposal.requirements.network },
      { field: "scheme", signed: "exact", proposed: proposal.requirements.scheme },
      { field: "payee", signed: bundle.mandate.payee, proposed: proposal.requirements.payTo },
      { field: "asset", signed: bundle.mandate.asset, proposed: proposal.requirements.asset },
      { field: "amount", signed: bundle.mandate.amount, proposed: proposal.requirements.amount },
    ].filter((field) => field.signed === field.proposed && !signed.receipt.diff.some((diff) => diff.field === field.field)) : [];
    return { kind: "receipt", example: false, taskId: id, ts: signed.receipt.ts, verdict: signed.receipt.verdict,
      reasons: signed.receipt.reasons, diff: signed.receipt.diff, matching, signatureValid, guardAddress: signed.guardAddress,
      digests: { receipt: receiptDigest(signed.receipt as GuardReceipt), mandate: signed.receipt.mandateDigest, proposal: signed.receipt.proposalDigest },
      bundle, proposal, inputs, anchor: !paid && !settlement?.txHash && !settlement?.settled ? { kind: "free" }
        : { kind: "paid", settled: settlement?.settled ?? false, onChainState: settlement?.onChainState ?? null, txHash: settlement?.txHash ?? null } };
  } catch { return { kind: "unreachable" }; }
}

export const getReceipt = cache((id: string) => loadReceipt(id, {
  origin: process.env.SOKOSUMI_API_URL, apiKey: process.env.SOKOSUMI_COWORKER_API_KEY,
  guardAddress: process.env.GUARD_ADDRESS, fetch,
}));
