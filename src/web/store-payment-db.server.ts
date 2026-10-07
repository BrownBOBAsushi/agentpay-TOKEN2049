import "server-only";
import { Pool, type PoolClient, type QueryConfig } from "pg";
import { z } from "zod";
import type { Db } from "../worker/db";
import { StopError } from "../orchestrator/journal";
import { blockfrostLookup, payApproved, walletHeaders, type PaymentDeps, type PaymentJournal, type PaymentOperation } from "../orchestrator/payment";
import { PaymentSchema } from "../orchestrator/transcript";
import { proposalDigest } from "../guard";
import { logStorePaymentFailure, paymentPgCode } from "./store-payment-errors.server";
import { PaymentBudget } from "../orchestrator/payment-budget";

export interface StorePaymentDb extends Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[], options?: { deadlineMs?: number }): Promise<{ rows: T[] }>;
}

export const STORE_SIGNING_ERROR = "Payment signing is interrupted or in progress. No second transaction will be signed; inspect the durable store payment.";
export class StoreSigningInterruptedError extends StopError {
  constructor() { super(STORE_SIGNING_ERROR); }
}
export class StorePaymentDatabaseError extends StopError {
  readonly pgCode: string | undefined;
  constructor(error: unknown, readonly operation: "read" | "claim" | "prepare" | "done") {
    super("Durable store payment database operation failed; inspect saved state before retrying.");
    this.pgCode = paymentPgCode(error); // Never retain the raw error or its cause.
  }
}
const rowSchema = z.object({ task_id: z.string(), event_id: z.string().min(1), state: z.enum(["signing", "prepared", "done"]),
  proposal_digest: z.string().regex(/^[0-9a-f]{64}$/), headers: z.record(z.string(), z.string()).nullable(),
  tx_hash: z.string().regex(/^[0-9a-f]{64}$/).nullable(), payment: PaymentSchema.nullable() });

// Each invocation has its own adapter. Ownership exists only after INSERT RETURNING;
// no process lock, file journal, or stale local cache can confer signing permission.
function paymentJournal(db: StorePaymentDb, endpoint: string, digest: string, deadlineMs?: number): PaymentJournal {
  let ownsClaim = false;
  let eventId: string;
  const query: Db["query"] = async (text, params) => {
    try { return await new PaymentBudget(deadlineMs).run(() => db.query(text, params, { deadlineMs })); }
    catch (error) { if (error instanceof StopError) throw error;
      throw new StorePaymentDatabaseError(error, text.startsWith("SELECT") ? "read" : text.startsWith("INSERT") ? "claim"
      : text.includes("state='done'") ? "done" : "prepare"); }
  };
  return {
    async claim(id, approvedDigest) {
      if (id.action !== "pay") throw new StopError("expected a payment action");
      if (approvedDigest !== digest) throw new StopError("durable payment proposal mismatch; no signing");
      const result = await query(`INSERT INTO store_payments(task_id,event_id,state,proposal_digest)
        VALUES($1,$2,'signing',$3) ON CONFLICT(task_id) DO NOTHING RETURNING task_id`, [id.taskId, id.eventId, digest]);
      ownsClaim = result.rows.length === 1;
      if (ownsClaim) eventId = id.eventId;
      return ownsClaim;
    },
    async get(id) {
      if (id.action !== "pay") throw new StopError("expected a payment action");
      const result = await query("SELECT task_id,event_id,state,proposal_digest,headers,tx_hash,payment FROM store_payments WHERE task_id=$1", [id.taskId]);
      if (result.rows.length === 0) return undefined;
      const parsed = rowSchema.safeParse(result.rows[0]);
      if (result.rows.length !== 1 || !parsed.success || parsed.data.task_id !== id.taskId) throw new StopError("Durable store payment row invalid; no signing");
      const row = parsed.data;
      if (row.proposal_digest !== digest) throw new StopError("saved payment does not match the approved proposal; no payment");
      eventId = row.event_id;
      if (ownsClaim && eventId !== id.eventId) throw new StopError("durable payment claim event invalid; no signing");
      if (row.state === "signing" && !ownsClaim) throw new StoreSigningInterruptedError();
      if (row.state !== "signing" && (!row.headers || !row.tx_hash)) throw new StopError("saved payment bytes missing; no second payment");
      if (row.state === "done" && (!row.payment || row.payment.txHash !== row.tx_hash)) throw new StopError("saved payment result invalid; no second payment");
      return { state: row.state, endpoint, proposalDigest: row.proposal_digest,
        ...(row.headers ? { headers: row.headers } : {}), ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
        ...(row.payment ? { payment: row.payment } : {}) };
    },
    async set(id, action) {
      if (action.proposalDigest !== digest || action.endpoint !== endpoint) throw new StopError("durable payment input mismatch; no payment");
      if (action.state === "signing") {
        if (!ownsClaim) throw new StoreSigningInterruptedError();
        return; // The owned signing claim is already committed.
      }
      if (!action.headers || !action.txHash) throw new StopError("saved payment bytes missing; no second payment");
      const params = [id.taskId, eventId, digest];
      const result = action.state === "prepared"
        ? await query(`UPDATE store_payments SET state='prepared',headers=$4::jsonb,tx_hash=$5,updated_at=now()
          WHERE task_id=$1 AND event_id=$2 AND proposal_digest=$3 AND state='signing' AND $6::boolean
          RETURNING task_id`, [...params, JSON.stringify(action.headers), action.txHash, ownsClaim])
        : await query(`UPDATE store_payments SET state='done',payment=$5::jsonb,updated_at=now()
          WHERE task_id=$1 AND event_id=$2 AND proposal_digest=$3 AND state IN ('prepared','done')
          AND tx_hash=$4 RETURNING task_id`, [...params, action.txHash, JSON.stringify(PaymentSchema.parse(action.payment))]);
      if (result.rows.length !== 1) throw new StopError("durable payment state changed; inspect saved result before retrying");
    },
  };
}

export function createStorePaymentRunner(options: { db: StorePaymentDb; deps?: PaymentDeps; env?: NodeJS.ProcessEnv }): PaymentOperation {
  const env = options.env ?? process.env;
  const deps = options.deps ?? { fetch, createHeaders: walletHeaders(env),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    lookupTransaction: blockfrostLookup(env, fetch), log: () => {} };
  return (proposal, endpoint, id, mandateExpiry, callOptions = {}) => payApproved(proposal, endpoint, deps,
    paymentJournal(options.db, endpoint, proposalDigest(proposal), callOptions.deadlineMs), id, mandateExpiry, { retryPrepared: true, ...callOptions });
}

// Pool.connect cannot cancel a queued acquisition. Destroy a late checkout, and
// destroy a timed-out query's connection so it cannot be reused ambiguously.
export function createStorePaymentDb(paymentPool: Pick<Pool, "connect">): StorePaymentDb {
  return { async query<T>(text: string, params?: unknown[], options: { deadlineMs?: number } = {}) {
    const budget = new PaymentBudget(options.deadlineMs);
    budget.remaining();
    let abandoned = false;
    let client: PoolClient | undefined;
    try {
      client = await budget.run(() => paymentPool.connect().then((connected) => {
        if (abandoned) { connected.release(true); throw new StopError("payment request deadline reached; saved state retained"); }
        client = connected;
        return connected;
      }));
      const queryTimeout = Math.min(10_000, budget.remaining());
      // pg implements query_timeout per query; @types/pg exposes it only on ClientConfig.
      const config: QueryConfig & { query_timeout: number } = { text, values: params, query_timeout: queryTimeout };
      const result = await budget.run(() => client!.query(config));
      return { rows: result.rows as T[] };
    } catch (error) {
      abandoned = true;
      throw error;
    } finally {
      client?.release(abandoned);
    }
  } };
}

let pool: Pool | undefined;
export function storePaymentDb(env: NodeJS.ProcessEnv = process.env): StorePaymentDb {
  if (!env.STORE_PAY_DATABASE_URL?.trim()) throw new StopError("Durable store payment database configuration missing.");
  if (!pool) {
    pool = new Pool({ connectionString: env.STORE_PAY_DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10_000, query_timeout: 10_000 });
    // An idle connection error must not print connection strings or terminate the process.
    pool.on("error", (error) => logStorePaymentFailure(error, "pool", env));
  }
  return createStorePaymentDb(pool);
}

export function storePaymentRunner(env: NodeJS.ProcessEnv = process.env): PaymentOperation {
  return createStorePaymentRunner({ db: storePaymentDb(env), env });
}

export async function isStorePaymentPrepared(db: StorePaymentDb, taskId: string, deadlineMs?: number): Promise<boolean> {
  try {
    const result = await new PaymentBudget(deadlineMs).run(() => db.query("SELECT state FROM store_payments WHERE task_id=$1", [taskId], { deadlineMs }));
    return result.rows.length === 1 && result.rows[0].state === "prepared";
  } catch (error) { if (error instanceof StopError) throw error; throw new StorePaymentDatabaseError(error, "read"); }
}
