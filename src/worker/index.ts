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

export async function pollOnce(input: {
  db: Db; core: CoreClient; coworkerId: string; guardKey: { privateKeyHex: string; address: string };
  nowSec: () => number; stopping: () => boolean; log: (stage: string, taskId: string) => void;
}): Promise<void> {
  const store = createStore(input.db);
  const ready = await input.core.listReadyTasks(input.coworkerId);
  const tasks = new Map(ready.map((task) => [task.id, task]));
  const unfinished = await input.db.query<{ task_id: string }>("SELECT task_id FROM task_journal WHERE stage <> 'complete'");
  for (const row of unfinished.rows) {
    if (input.stopping()) return;
    try { tasks.set(row.task_id, await input.core.getTask(row.task_id)); }
    catch { input.log("fetch_failed", row.task_id); }
  }
  for (const task of tasks.values()) {
    if (input.stopping()) return;
    if (task.coworkerId && task.coworkerId !== input.coworkerId) { input.log("wrong_coworker", task.id); continue; }
    try {
      // TODO(T-008): branch to the paid flow here when paid Task routing is defined.
      await runFreeFlow({ task, core: input.core, store, guardKey: input.guardKey, nowSec: input.nowSec(), log: input.log });
    } catch { input.log("blocked", task.id); }
  }
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const db = createPgDb(config.databaseUrl);
  const core = createCoreClient({ origin: config.origin, apiKey: config.apiKey, fetch });
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
          nowSec: () => Math.floor(Date.now() / 1000), stopping: () => stop.signal.aborted,
          log: (stage, taskId) => console.log(`${stage} ${JSON.stringify(taskId)}`) });
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
  main().catch(() => { console.error("worker_failed"); process.exitCode = 1; });
}
