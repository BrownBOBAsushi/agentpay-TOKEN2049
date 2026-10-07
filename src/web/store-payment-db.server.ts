import "server-only";
import { Pool } from "pg";
import { z } from "zod";
import type { Db } from "../worker/db";
import { StopError } from "../orchestrator/journal";
import { blockfrostLookup, payApproved, walletHeaders, type PaymentDeps, type PaymentJournal, type PaymentOperation } from "../orchestrator/payment";
import { PaymentSchema } from "../orchestrator/transcript";

export const STORE_SIGNING_ERROR = "Payment signing is interrupted or in progress. No second transaction will be signed; inspect the durable store payment.";
export class StoreSigningInterruptedError extends StopError {
  constructor() { super(STORE_SIGNING_ERROR); }
}
const rowSchema = z.object({ task_id: z.string(), event_id: z.string().min(1), state: z.enum(["signing", "prepared", "done"]),
  proposal_digest: z.string().regex(/^[0-9a-f]{64}$/), headers: z.record(z.string(), z.string()).nullable(),
  tx_hash: z.string().regex(/^[0-9a-f]{64}$/).nullable(), payment: PaymentSchema.nullable() });

// Each invocation has its own adapter. Ownership exists only after INSERT RETURNING;
// no process lock, file journal, or stale local cache can confer signing permission.
function paymentJournal(db: Db, endpoint: string): PaymentJournal {
  let ownsClaim = false;
  let digest: string;
  let eventId: string;
  const query: Db["query"] = async (text, params) => {
    try { return await db.query(text, params); }
    catch { throw new StopError("Durable store payment database operation failed; inspect saved state before retrying."); }
  };
  return {
    async claim(id, approvedDigest) {
      if (id.action !== "pay") throw new StopError("expected a payment action");
      digest = approvedDigest;
      const result = await query(`INSERT INTO store_payments(task_id,event_id,state,proposal_digest)
        VALUES($1,$2,'signing',$3) ON CONFLICT(task_id) DO NOTHING RETURNING task_id`, [id.taskId, id.eventId, digest]);
      ownsClaim = result.rows.length === 1;
      return ownsClaim;
    },
    async get(id) {
      const result = await query("SELECT task_id,event_id,state,proposal_digest,headers,tx_hash,payment FROM store_payments WHERE task_id=$1", [id.taskId]);
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
      const params = [id.taskId, eventId, digest, JSON.stringify(action.headers), action.txHash];
      const result = action.state === "prepared"
        ? await query(`UPDATE store_payments SET state='prepared',headers=$4::jsonb,tx_hash=$5,updated_at=now()
          WHERE task_id=$1 AND event_id=$2 AND proposal_digest=$3
          AND ((state='signing' AND $6::boolean) OR (state='prepared' AND headers=$4::jsonb AND tx_hash=$5))
          RETURNING task_id`, [...params, ownsClaim])
        : await query(`UPDATE store_payments SET state='done',payment=$6::jsonb,updated_at=now()
          WHERE task_id=$1 AND event_id=$2 AND proposal_digest=$3 AND state IN ('prepared','done')
          AND headers=$4::jsonb AND tx_hash=$5 RETURNING task_id`, [...params, JSON.stringify(PaymentSchema.parse(action.payment))]);
      if (result.rows.length !== 1) throw new StopError("durable payment state changed; inspect saved result before retrying");
    },
  };
}

export function createStorePaymentRunner(options: { db: Db; deps?: PaymentDeps; env?: NodeJS.ProcessEnv }): PaymentOperation {
  const env = options.env ?? process.env;
  const deps = options.deps ?? { fetch, createHeaders: walletHeaders(env),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    lookupTransaction: blockfrostLookup(env, fetch), log: () => {} };
  return (proposal, endpoint, id, mandateExpiry) => payApproved(proposal, endpoint, deps, paymentJournal(options.db, endpoint), id, mandateExpiry, { retryPrepared: true });
}

let pool: Pool | undefined;
export function storePaymentRunner(env: NodeJS.ProcessEnv = process.env): PaymentOperation {
  if (!env.STORE_PAY_DATABASE_URL?.trim()) throw new StopError("Durable store payment database configuration missing.");
  if (!pool) {
    pool = new Pool({ connectionString: env.STORE_PAY_DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10_000 });
    // An idle connection error must not print connection strings or terminate the process.
    pool.on("error", () => {});
  }
  const db: Db = { query: async (text, params) => ({ rows: (await pool!.query(text, params)).rows }) };
  return createStorePaymentRunner({ db, env });
}
