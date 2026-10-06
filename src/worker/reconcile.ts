import type { Db } from "./db";
import { createPgDb } from "./db";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createMpsClient, mpsBaseUrl } from "./mps";
import type { ListedPayment } from "./mps";
import { createStore } from "./store";
import { WorkerError } from "./errors";
import { createWorkerLock } from "./lock";
import type { WorkerLock } from "./lock";

export async function reconcileTerms(input: {
  db: Db; taskId: string; lock: WorkerLock; payments: (scan: { agentIdentifier: string; termsTimeMs: number }) => AsyncIterable<ListedPayment>;
}): Promise<"adopted" | "cleared" | "not-pending" | "worker-running" | "too-recent"> {
  if (!await input.lock.tryAcquire()) return "worker-running";
  try { return await recoverTerms(input); }
  finally { await input.lock.release(); }
}

async function recoverTerms(input: Parameters<typeof reconcileTerms>[0]): Promise<"adopted" | "cleared" | "not-pending" | "too-recent"> {
  const { db, taskId } = input;
  const pending = await db.query<{ stamp: string; recent: boolean }>(
    "SELECT updated_at::text AS stamp, updated_at > now() - INTERVAL '60 seconds' AS recent FROM side_effect WHERE task_id = $1 AND event_id = '-' AND action = 'terms' AND status = 'pending'", [taskId]);
  if (!pending.rows.length) return "not-pending";
  if (pending.rows[0].recent) return "too-recent";
  const journal = await createStore(db).readJournal<{ request?: { inputHash?: string; agentIdentifier?: string } }>(taskId);
  const saved = await db.query<{ termsTime: string }>(
    'SELECT updated_at::text AS "termsTime" FROM task_journal WHERE task_id = $1', [taskId]);
  const termsTimeMs = Date.parse(saved.rows[0]?.termsTime);
  const agentIdentifier = journal?.data.request?.agentIdentifier;
  const inputHash = journal?.data.request?.inputHash;
  if (journal?.mode !== "paid" || journal.stage !== "terms" || !inputHash || !agentIdentifier || !Number.isFinite(termsTimeMs)) throw new WorkerError("Missing saved payment request");
  let found: ListedPayment | undefined;
  for await (const payment of input.payments({ agentIdentifier, termsTimeMs })) {
    let metadata: unknown;
    try { metadata = JSON.parse(payment.metadata ?? "null"); } catch { continue; }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
      || !("taskId" in metadata) || metadata.taskId !== taskId || payment.inputHash !== inputHash) continue;
    if (found && found.id !== payment.id) throw new WorkerError("Multiple matching payments require manual reconciliation");
    found = payment;
  }
  const params = [taskId, pending.rows[0].stamp];
  const result = found
    ? await db.query("UPDATE side_effect SET status = 'done', result = $3::jsonb, updated_at = now() WHERE task_id = $1 AND event_id = '-' AND action = 'terms' AND status = 'pending' AND updated_at::text = $2 RETURNING task_id", [...params, JSON.stringify(found)])
    : await db.query("DELETE FROM side_effect WHERE task_id = $1 AND event_id = '-' AND action = 'terms' AND status = 'pending' AND updated_at::text = $2 RETURNING task_id", params);
  return result.rows.length ? found ? "adopted" : "cleared" : "not-pending";
}

async function main() {
  const taskId = z.string().regex(/^[A-Za-z0-9_-]+$/).parse(process.argv[2]);
  if (process.argv.length !== 3) throw new WorkerError("Expected one Task ID");
  const config = z.object({ DATABASE_URL: z.string().url().regex(/^postgres(?:ql)?:\/\//),
    MPS_BASE_URL: z.string(), MPS_RUNTIME_TOKEN: z.string().min(1) }).parse(process.env);
  const mps = createMpsClient({ baseUrl: mpsBaseUrl(config.MPS_BASE_URL), token: config.MPS_RUNTIME_TOKEN, fetch });
  const db = createPgDb(config.DATABASE_URL);
  try {
    const outcome = await reconcileTerms({ db, taskId, lock: createWorkerLock(config.DATABASE_URL), payments: (scan) => mps.listPayments(scan) });
    console.log(`${taskId} ${outcome}`);
  } finally { await db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Failures produce no payment, configuration, or error text; the exit code signals failure.
  main().catch(() => { process.exitCode = 1; });
}
