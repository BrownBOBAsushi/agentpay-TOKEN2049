import "server-only";
import { z } from "zod";
import { mandateDigest, proposalDigest, verifyReceipt } from "../guard";
import { PaymentSchema } from "../orchestrator/transcript";
import type { PaymentOperation } from "../orchestrator/payment";
import { createStorePaymentRunner, storePaymentDb, isStorePaymentPrepared, StoreSigningInterruptedError, STORE_SIGNING_ERROR } from "./store-payment-db.server";
import { logStorePaymentFailure } from "./store-payment-errors.server";
import type { Db } from "../worker/db";
import { createCoreClient } from "../worker/core";
import { loadReceipt } from "./receipt-data.server";
import { hasStoreLiveKey, validateStoreMandate, STORE_AMOUNT, STORE_PAYEE } from "./store-live.server";

const requestSchema = z.strictObject({ taskId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) });
const eventPageSchema = z.object({ data: z.array(z.object({ id: z.string().min(1).optional(), taskId: z.string().optional(),
  status: z.string().nullish(), comment: z.string().nullish() })),
  meta: z.object({ pagination: z.object({ nextCursor: z.string().nullish() }).optional() }).optional() });
const headers = { "Cache-Control": "no-store" };

async function paymentEventId(taskId: string, digest: string, env: NodeJS.ProcessEnv, fetcher: typeof fetch): Promise<string> {
  const core = createCoreClient({ origin: env.SOKOSUMI_API_URL!, apiKey: env.SOKOSUMI_COWORKER_API_KEY!, fetch: fetcher });
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
    const result = eventPageSchema.parse(await core.request(`/v1/tasks/${encodeURIComponent(taskId)}/events${query}`));
    for (const event of result.data) {
      if (!event.id || event.status !== "COMPLETED" || (event.taskId !== undefined && event.taskId !== taskId)) continue;
      let signed: unknown;
      try { signed = JSON.parse(event.comment ?? ""); } catch { continue; }
      if (verifyReceipt(signed, env.GUARD_ADDRESS!) && z.object({ digest: z.literal(digest) }).safeParse(signed).success) return event.id;
    }
    cursor = result.meta?.pagination?.nextCursor ?? undefined;
    if (!cursor || seen.has(cursor)) break;
    seen.add(cursor);
  }
  throw new Error("Verified completion event unavailable.");
}

export async function handleStorePay(request: Request, options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; pay?: PaymentOperation; db?: Db } = {}): Promise<Response> {
  const startedAt = Date.now();
  let failureLogged = false;
  const env = options.env ?? process.env;
  if (!hasStoreLiveKey(request, env) || !env.ORCHESTRATOR_WALLET_MNEMONIC || !env.BLOCKFROST_API_KEY_PREPROD
    || !env.SOKOSUMI_API_URL || !env.SOKOSUMI_COWORKER_API_KEY || !env.GUARD_ADDRESS || !env.STORE_PAY_DATABASE_URL?.trim()) {
    return Response.json({ error: "Live payment access denied." }, { status: 403, headers });
  }
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Send only a valid taskId." }, { status: 400, headers });
  try {
    const taskId = parsed.data.taskId;
    const fetcher = options.fetch ?? fetch;
    // Override viewer caching: only fresh Task inputs and a verified APPROVE can authorize payment.
    const freshFetch: typeof fetch = (input, init) => fetcher(input, { ...init, cache: "no-store", next: { revalidate: 0 } });
    const data = await loadReceipt(taskId, { origin: env.SOKOSUMI_API_URL, apiKey: env.SOKOSUMI_COWORKER_API_KEY,
      guardAddress: env.GUARD_ADDRESS, fetch: freshFetch });
    if (data.kind !== "receipt" || data.example || !data.receiptValid || !data.signatureValid || !data.inputsBound || !data.sentinelOk
      || data.verdict !== "APPROVE" || data.taskId !== taskId || data.guardAddress !== env.GUARD_ADDRESS
      || !data.bundle || !data.proposal || !data.digests.receipt
      || data.digests.mandate !== mandateDigest(data.bundle.mandate) || data.digests.mandate !== data.bundle.digest
      || data.digests.proposal !== proposalDigest(data.proposal)) throw new Error("Receipt is not a verified store APPROVE.");
    // An already signed transaction/result remains recoverable after expiry.
    // The payer still enforces expiry before signing any new transaction.
    const bundle = validateStoreMandate(data.bundle, { allowExpired: true });
    const requirements = data.proposal.requirements;
    if (data.proposal.kind !== "x402" || requirements.scheme !== "exact" || requirements.network !== "cardano:preprod"
      || requirements.payTo !== STORE_PAYEE || requirements.asset !== "lovelace" || requirements.amount !== STORE_AMOUNT) {
      throw new Error("Receipt does not approve the store payment.");
    }
    const endpoint = new URL("/api/store/latte", request.url);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("Invalid store origin.");
    const eventId = await paymentEventId(taskId, data.digests.receipt, env, freshFetch);
    const db = options.db ?? storePaymentDb(env);
    const pay = options.pay ?? createStorePaymentRunner({ db, env });
    const id = { taskId, eventId, action: "pay" as const };
    let payment;
    try {
      // Reserve roughly 90 s for one resumed recovery inside maxDuration 300.
      payment = PaymentSchema.parse(await pay(data.proposal, endpoint.href, id, bundle.mandate.expiry, { deadlineMs: startedAt + 195_000 }));
    } catch (error) {
      logStorePaymentFailure(error, "payment", env); failureLogged = true;
      if (error instanceof StoreSigningInterruptedError) throw error;
      let prepared;
      try { prepared = await isStorePaymentPrepared(db, taskId); }
      catch (stateError) { logStorePaymentFailure(stateError, "state", env); throw stateError; }
      if (!prepared) throw error;
      try {
        payment = PaymentSchema.parse(await pay(data.proposal, endpoint.href, id, bundle.mandate.expiry,
          { recoveryOnly: true, deadlineMs: Math.min(Date.now() + 90_000, startedAt + 290_000) }));
      } catch (recoveryError) { logStorePaymentFailure(recoveryError, "recovery", env); throw recoveryError; }
    }
    // Return only validated public fields. Never expose provider/SDK errors, input, or headers.
    return Response.json({ txHash: payment.txHash, status: payment.status }, { headers });
  } catch (error) {
    if (!failureLogged) logStorePaymentFailure(error, "request", env);
    if (error instanceof StoreSigningInterruptedError) return Response.json({ error: STORE_SIGNING_ERROR }, { status: 409, headers });
    return Response.json({ error: "Payment stopped. Verify the APPROVE receipt, configuration and durable store payment before retrying." }, { status: 409, headers });
  }
}
