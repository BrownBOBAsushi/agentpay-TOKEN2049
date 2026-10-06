import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config";
import { createCoreClient } from "./core";
import type { CoreClient } from "./core";
import { createPgDb } from "./db";
import type { Db } from "./db";
import { runFreeFlow } from "./free-flow";
import { migrate } from "./migrate";
import { createStore } from "./store";
import type { TaskMode } from "./store";
import { advancePaidTask } from "./paid-flow";
import type { PaidTerms } from "./paid-flow";
import { createMpsClient } from "./mps";
import type { MpsClient } from "./mps";
import { formatWorkerFailure, workerErrorDetail, WorkerError } from "./errors";

export function taskMode(journal: { mode: TaskMode } | null, enabled: boolean): TaskMode {
  return journal?.mode ?? (enabled ? "paid" : "free");
}

export async function pollOnce(input: {
  db: Db; core: CoreClient; coworkerId: string; guardKey: { privateKeyHex: string; address: string };
  nowSec: () => number; stopping: () => boolean; log: (stage: string, taskId: string, detail?: string) => void;
  paidTasksEnabled?: boolean; paid?: PaidTerms; mps?: MpsClient;
}): Promise<void> {
  const store = createStore(input.db);
  const ready = await input.core.listReadyTasks(input.coworkerId);
  const tasks = new Map(ready.map((task) => [task.id, task]));
  const unfinished = await input.db.query<{ task_id: string }>("SELECT task_id FROM task_journal WHERE (mode = 'free' AND stage <> 'complete') OR (mode = 'paid' AND stage NOT IN ('settled', 'failed'))");
  for (const row of unfinished.rows) {
    if (input.stopping()) return;
    try { tasks.set(row.task_id, await input.core.getTask(row.task_id)); }
    catch { input.log("fetch_failed", row.task_id); }
  }
  for (const task of tasks.values()) {
    if (input.stopping()) return;
    if (task.coworkerId && task.coworkerId !== input.coworkerId) { input.log("wrong_coworker", task.id); continue; }
    try {
      const journal = await store.readJournal(task.id);
      if (taskMode(journal, input.paidTasksEnabled ?? false) === "paid") {
        if (!input.mps || !input.paid) throw new WorkerError("Paid Worker configuration is required");
        await advancePaidTask({ task, core: input.core, mps: input.mps, paid: input.paid, store, guardKey: input.guardKey, nowSec: input.nowSec(), log: input.log });
      } else {
        await runFreeFlow({ task, core: input.core, store, guardKey: input.guardKey, nowSec: input.nowSec(), log: input.log });
      }
    } catch (error) { input.log("blocked", task.id, workerErrorDetail(error)); }
  }
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const db = createPgDb(config.databaseUrl);
  const core = createCoreClient({ origin: config.origin, apiKey: config.apiKey, fetch });
  const mps = config.paid ? createMpsClient({ baseUrl: config.paid.baseUrl, token: config.paid.token, fetch }) : undefined;
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  try {
    await migrate(db);
    await core.me();
    while (!stop.signal.aborted) {
      try {
        await pollOnce({ db, core, coworkerId: config.coworkerId, guardKey: config.guardKey,
          paidTasksEnabled: config.paidTasksEnabled, paid: config.paid, mps,
          nowSec: () => Math.floor(Date.now() / 1000), stopping: () => stop.signal.aborted,
          log: (stage, taskId, detail) => console.log(`${stage} ${JSON.stringify(taskId)}${detail ? ` ${detail}` : ""}`) });
      } catch { console.error("poll_failed"); }
      if (!stop.signal.aborted) {
        try { await sleep(config.pollIntervalMs, undefined, { signal: stop.signal }); }
        catch { if (!stop.signal.aborted) throw new Error("Worker sleep failed"); }
      }
    }
  } finally {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => { console.error(formatWorkerFailure(error)); process.exitCode = 1; });
}
