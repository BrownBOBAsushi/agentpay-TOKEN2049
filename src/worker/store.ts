import type { Db } from "./db";
import { WorkerError } from "./errors";

export type SideEffectKey = { taskId: string; eventId: string; action: string };
export type TaskMode = "free" | "paid";
export type JournalEntry<T = unknown> = { taskId: string; stage: string; data: T; mode: TaskMode };

export class UncertainSideEffectError extends WorkerError {
  constructor() {
    super("Side effect is pending; reconcile it before any retry");
    this.name = "UncertainSideEffectError";
  }
}

export class SafeToRetryError extends WorkerError {
  constructor(message = "Failure is known to have caused no side effect") {
    super(message);
    this.name = "SafeToRetryError";
  }
}

function serialize(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Store value must be JSON serializable");
  return encoded;
}

export function createStore(db: Db) {
  return {
    // Results must be JSON-compatible. An uncertain call is never retried here.
    async once<T>(key: SideEffectKey, fn: () => Promise<T>): Promise<T> {
      const params = [key.taskId, key.eventId, key.action];
      const claim = await db.query<{ task_id: string }>(
        `INSERT INTO side_effect (task_id, event_id, action, status)
         VALUES ($1, $2, $3, 'pending') ON CONFLICT DO NOTHING RETURNING task_id`, params,
      );
      if (claim.rows.length === 0) {
        const existing = await db.query<{ status: "pending" | "done"; result: T }>(
          "SELECT status, result FROM side_effect WHERE task_id = $1 AND event_id = $2 AND action = $3", params,
        );
        if (existing.rows[0]?.status === "done") return existing.rows[0].result;
        throw new UncertainSideEffectError();
      }

      let result: T;
      try {
        result = await fn();
      } catch (error) {
        if (error instanceof SafeToRetryError) {
          await db.query(
            "DELETE FROM side_effect WHERE task_id = $1 AND event_id = $2 AND action = $3 AND status = 'pending'", params,
          );
        }
        throw error;
      }

      // Once fn succeeds, even a serialization or database error must retain pending.
      const saved = await db.query<{ task_id: string }>(
        `UPDATE side_effect SET status = 'done', result = $4::jsonb, updated_at = now()
         WHERE task_id = $1 AND event_id = $2 AND action = $3 AND status = 'pending' RETURNING task_id`,
        [...params, serialize(result)],
      );
      if (saved.rows.length !== 1) throw new UncertainSideEffectError();
      return result;
    },

    async isNonceUsed(payer: string, nonce: string, taskId: string): Promise<boolean> {
      const result = await db.query<{ task_id: string }>(
        "SELECT task_id FROM mandate_nonce WHERE payer = $1 AND nonce = $2", [payer, nonce],
      );
      return result.rows.length > 0 && result.rows[0].task_id !== taskId;
    },

    async consumeNonce(payer: string, nonce: string, taskId: string): Promise<boolean> {
      const result = await db.query<{ task_id: string }>(
        `INSERT INTO mandate_nonce (payer, nonce, task_id) VALUES ($1, $2, $3)
         ON CONFLICT (payer, nonce) DO UPDATE SET task_id = EXCLUDED.task_id
         WHERE mandate_nonce.task_id = EXCLUDED.task_id RETURNING task_id`, [payer, nonce, taskId],
      );
      return result.rows.length === 1;
    },

    async readJournal<T = unknown>(taskId: string): Promise<JournalEntry<T> | null> {
      const result = await db.query<JournalEntry<T>>(
        'SELECT task_id AS "taskId", stage, data, mode FROM task_journal WHERE task_id = $1', [taskId],
      );
      return result.rows[0] ?? null;
    },

    async createJournal(taskId: string, stage: string, data: unknown, mode: TaskMode): Promise<void> {
      await db.query("INSERT INTO task_journal (task_id, stage, data, mode) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (task_id) DO NOTHING",
        [taskId, stage, serialize(data), mode]);
    },

    async writeJournal(taskId: string, stage: string, data: unknown, mode: TaskMode = "free"): Promise<void> {
      await db.query(
        `INSERT INTO task_journal (task_id, stage, data, mode) VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (task_id) DO UPDATE SET stage = EXCLUDED.stage, data = EXCLUDED.data, updated_at = now()`,
        [taskId, stage, serialize(data), mode],
      );
    },
  };
}
