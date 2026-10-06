import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { Db } from "./db";
import { migrate } from "./migrate";
import { createStore, SafeToRetryError, UncertainSideEffectError } from "./store";

let database: PGlite;
let db: Db;
let store: ReturnType<typeof createStore>;
const key = { taskId: "task-a", eventId: "event-a", action: "submit-result" };

beforeAll(async () => {
  database = new PGlite(); // In-process only; no database URL or network.
  db = { query: (text, params) => database.query(text, params) };
  await migrate(db);
  store = createStore(db);
}, 20_000);

beforeEach(async () => {
  await db.query("TRUNCATE side_effect, mandate_nonce, task_journal");
});

afterAll(async () => {
  await database?.close();
});

test("migration runs twice and preserves existing data", async () => {
  await store.writeJournal("task-a", "started", { count: 1 });
  await migrate(db);
  await migrate(db);
  expect(await store.readJournal("task-a")).toEqual({ taskId: "task-a", stage: "started", data: { count: 1 } });
});

test("once persists its result and a new store instance does not run it again", async () => {
  let calls = 0;
  const fn = async () => { calls += 1; return { result: "signed-receipt", count: 1 }; };
  expect(await store.once(key, fn)).toEqual({ result: "signed-receipt", count: 1 });
  expect(await createStore(db).once(key, fn)).toEqual({ result: "signed-receipt", count: 1 });
  expect(calls).toBe(1);
});

test("a persisted pending row prevents an automatic retry", async () => {
  await db.query("INSERT INTO side_effect(task_id, event_id, action, status) VALUES ($1, $2, $3, 'pending')", [key.taskId, key.eventId, key.action]);
  let calls = 0;
  await expect(store.once(key, async () => { calls += 1; return "unexpected"; })).rejects.toBeInstanceOf(UncertainSideEffectError);
  expect(calls).toBe(0);
});

test("SafeToRetryError removes the pending row and permits retry", async () => {
  const error = new SafeToRetryError("Rejected before any effect");
  await expect(store.once(key, async () => { throw error; })).rejects.toBe(error);
  expect((await db.query("SELECT status FROM side_effect")).rows).toEqual([]);
  expect(await store.once(key, async () => "retried")).toBe("retried");
});

test("an ordinary error leaves a pending row and blocks retry", async () => {
  const error = new Error("Response lost after send");
  await expect(store.once(key, async () => { throw error; })).rejects.toBe(error);
  expect((await db.query("SELECT status FROM side_effect")).rows).toEqual([{ status: "pending" }]);
  await expect(store.once(key, async () => "unexpected")).rejects.toBeInstanceOf(UncertainSideEffectError);
});

test("concurrent calls claim the same key exactly once", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let calls = 0;
  const first = store.once(key, async () => {
    calls += 1;
    entered();
    await gate;
    return { done: true };
  });
  await started;
  try {
    await expect(createStore(db).once(key, async () => { calls += 1; return { done: true }; }))
      .rejects.toBeInstanceOf(UncertainSideEffectError);
  } finally {
    release();
  }
  expect(await first).toEqual({ done: true });
  expect(calls).toBe(1);
});

test("each task, event, and action is part of the idempotency key", async () => {
  let calls = 0;
  for (const distinct of [key, { ...key, taskId: "task-b" }, { ...key, eventId: "event-b" }, { ...key, action: "complete" }]) {
    await store.once(distinct, async () => ++calls);
  }
  expect(calls).toBe(4);
});

test("a non-JSON result leaves the completed external call uncertain", async () => {
  await expect(store.once(key, async () => undefined)).rejects.toBeInstanceOf(TypeError);
  await expect(store.once(key, async () => "unexpected")).rejects.toBeInstanceOf(UncertainSideEffectError);
});

test("result persistence failure does not reopen an executed side effect", async () => {
  const failingDb: Db = {
    query: (text, params) => {
      if (text.includes("UPDATE side_effect")) throw new SafeToRetryError("Database write failed");
      return db.query(text, params);
    },
  };
  await expect(createStore(failingDb).once(key, async () => "sent")).rejects.toBeInstanceOf(SafeToRetryError);
  await expect(store.once(key, async () => "unexpected")).rejects.toBeInstanceOf(UncertainSideEffectError);
});

test("nonce use is scoped to the payer and permits the original task", async () => {
  expect(await store.isNonceUsed("payer", "nonce", "task-a")).toBe(false);
  expect(await store.consumeNonce("payer", "nonce", "task-a")).toBe(true);
  expect(await store.isNonceUsed("payer", "nonce", "task-a")).toBe(false);
  expect(await store.isNonceUsed("payer", "nonce", "task-b")).toBe(true);
  expect(await store.consumeNonce("payer", "nonce", "task-b")).toBe(false);
  expect(await store.consumeNonce("payer", "nonce", "task-a")).toBe(true);
  expect(await store.consumeNonce("other-payer", "nonce", "task-b")).toBe(true);
});

test("concurrent tasks cannot both consume one nonce", async () => {
  const results = await Promise.all([
    store.consumeNonce("payer", "nonce", "task-a"),
    createStore(db).consumeNonce("payer", "nonce", "task-b"),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
});

test("journal upserts stage and data without changing other tasks", async () => {
  expect(await store.readJournal("missing")).toBeNull();
  await store.writeJournal("task-a", "pending", { text: "quotes ' and Unicode é" });
  await store.writeJournal("task-b", "started", [1, 2]);
  await store.writeJournal("task-a", "done", { result: "saved" });
  expect(await store.readJournal("task-a")).toEqual({ taskId: "task-a", stage: "done", data: { result: "saved" } });
  expect(await store.readJournal("task-b")).toEqual({ taskId: "task-b", stage: "started", data: [1, 2] });
});
