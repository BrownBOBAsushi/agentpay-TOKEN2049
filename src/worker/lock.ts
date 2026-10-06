import { Client } from "pg";
import { WorkerError } from "./errors";

// One shared session-level lock for agentpay-guard-worker and operator recovery.
const WORKER_LOCK_KEY = "72760374954241";
export interface WorkerLock {
  tryAcquire(): Promise<boolean>;
  release(): Promise<void>;
}
export interface LockClient {
  connect(): Promise<unknown>;
  query(sql: string, params: string[]): Promise<{ rows: { acquired?: boolean }[] }>;
  end(): Promise<void>;
  on(event: "error" | "end", listener: () => void): unknown;
}
export class LockError extends WorkerError {
  constructor() {
    super("another worker or reconcile holds the lock");
    this.name = "LockError";
  }
}

export function createWorkerLock(databaseUrl: string): WorkerLock {
  return createSessionLock(new Client({ connectionString: databaseUrl }));
}

export function createSessionLock(client: LockClient): WorkerLock {
  let held = false;
  let closed = false;
  // A lost lock session must end the process, not leave an unfenced Worker running.
  client.on("error", () => { process.exitCode = 1; if (held) process.exit(1); });
  client.on("end", () => { if (held && !closed) process.exit(1); });
  return {
    async tryAcquire() {
      try {
        await client.connect();
        const result = await client.query("SELECT pg_try_advisory_lock($1::bigint) AS acquired", [WORKER_LOCK_KEY]);
        held = result.rows[0]?.acquired === true;
        if (!held) { closed = true; await client.end(); }
        return held;
      } catch {
        closed = true;
        await client.end().catch(() => {});
        throw new WorkerError("Worker lock connection failed");
      }
    },
    async release() {
      if (closed) return;
      closed = true;
      try {
        if (held) await client.query("SELECT pg_advisory_unlock($1::bigint)", [WORKER_LOCK_KEY]);
      } finally { held = false; await client.end(); }
    },
  };
}

export async function withWorkerLock<T>(lock: WorkerLock, run: () => Promise<T>): Promise<T> {
  if (!await lock.tryAcquire()) throw new LockError();
  try { return await run(); }
  finally { await lock.release(); }
}
