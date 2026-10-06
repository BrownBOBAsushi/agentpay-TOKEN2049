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
  constructor(message: "another worker or reconcile holds the lock" | "lock instance already in use" = "another worker or reconcile holds the lock") {
    super(message);
    this.name = "LockError";
  }
}

export function createWorkerLock(databaseUrl: string): WorkerLock {
  return createSessionLock(new Client({ connectionString: databaseUrl }));
}

type LockState = "idle" | "acquiring" | "held" | "closed";

export function createSessionLock(client: LockClient): WorkerLock & { readonly state: LockState } {
  let state: LockState = "idle";
  let ending: Promise<void> | undefined;
  let releasing: Promise<void> | undefined;
  const endOwnSession = () => {
    ending ??= Promise.resolve().then(() => client.end()).finally(() => { state = "closed"; });
    return ending;
  };
  // Only the owner changes its state. Session loss while held is always fatal.
  client.on("error", () => { process.exitCode = 1; if (state === "held") process.exit(1); });
  client.on("end", () => { if (state === "held") process.exit(1); });
  return {
    get state() { return state; },
    async tryAcquire() {
      // Keep this outside the owner's cleanup catch: rejected reuse must not end its session.
      if (state !== "idle" || ending) throw new LockError("lock instance already in use");
      state = "acquiring";
      try {
        await client.connect();
        const result = await client.query("SELECT pg_try_advisory_lock($1::bigint) AS acquired", [WORKER_LOCK_KEY]);
        if (result.rows[0]?.acquired === true) { state = "held"; return true; }
        state = "idle";
        await endOwnSession();
        return false;
      } catch {
        await endOwnSession().catch(() => {});
        throw new WorkerError("Worker lock connection failed");
      }
    },
    async release() {
      if (state === "closed") return;
      if (state === "acquiring") throw new LockError("lock instance already in use");
      releasing ??= (async () => {
        try {
          if (state === "held") await client.query("SELECT pg_advisory_unlock($1::bigint)", [WORKER_LOCK_KEY]);
        } finally { state = "idle"; await endOwnSession(); }
      })();
      await releasing;
    },
  };
}

export async function withWorkerLock<T>(lock: WorkerLock, run: () => Promise<T>): Promise<T> {
  if (!await lock.tryAcquire()) throw new LockError();
  try { return await run(); }
  finally { await lock.release(); }
}
