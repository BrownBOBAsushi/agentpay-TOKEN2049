import type { CoreClient, CoreTask } from "./core";
import { runGuardTask } from "./guard-task";
import type { GuardTaskInput } from "./guard-task";

export async function runFreeFlow(input: {
  task: CoreTask; core: CoreClient; store: GuardTaskInput["store"];
  guardKey: GuardTaskInput["guardKey"]; nowSec: number;
  log?: (stage: string, taskId: string) => void;
}): Promise<void> {
  const { task, core, store } = input;
  const log = (stage: string) => input.log?.(stage, task.id);
  const key = (action: string) => ({ taskId: task.id, eventId: "-", action });
  let journal = await store.readJournal(task.id);
  if (journal?.stage === "complete") return;
  if (!journal && task.status === "RUNNING") { log("unowned"); return; }
  if (!["READY", "RUNNING", "COMPLETED"].includes(task.status)) return;
  if (!journal) {
    if (task.status !== "READY") return;
    // Record ownership before posting RUNNING, including the restart input.
    await store.writeJournal(task.id, "ready", { description: task.description ?? "" });
    journal = await store.readJournal(task.id);
  }
  if (!["ready", "start", "check"].includes(journal!.stage)) throw new Error("Unknown Task journal stage");
  let result: string;
  if (journal!.stage === "check") {
    if (typeof journal!.data !== "string") throw new Error("Task result must be stored as text");
    result = journal!.data;
  } else {
    const saved = journal!.data as { description?: unknown };
    if (!saved || typeof saved.description !== "string") throw new Error("Missing saved Task description");
    await store.once(key("start"), async () => { await core.postEvent(task.id, { status: "RUNNING" }); return null; });
    await store.writeJournal(task.id, "start", saved);
    log("start");
    result = await store.once(key("check"), () => runGuardTask({ taskId: task.id, description: saved.description as string, nowSec: input.nowSec, store, guardKey: input.guardKey }));
    await store.writeJournal(task.id, "check", result);
    log("check");
  }
  await store.once(key("complete"), async () => { await core.postEvent(task.id, { status: "COMPLETED", comment: result }); return null; });
  await store.writeJournal(task.id, "complete", result);
  log("complete");
}
