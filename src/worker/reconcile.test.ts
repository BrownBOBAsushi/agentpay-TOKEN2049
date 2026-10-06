import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { Db } from "./db";
import { migrate } from "./migrate";
import { createStore } from "./store";
import { createMpsClient } from "./mps";
import type { PaymentRequest } from "./mps";
import { reconcileTerms } from "./reconcile";
import type { ListedPayment } from "./mps";
import { withWorkerLock } from "./lock";

let database: PGlite;
let db: Db;
beforeAll(async () => { database = new PGlite(); db = { query: (text, params) => database.query(text, params) }; await migrate(db); }, 20_000);
beforeEach(async () => { await db.query("TRUNCATE side_effect, task_journal"); });
afterAll(async () => { await database?.close(); });
const key = { taskId: "task-reconcile", eventId: "-", action: "terms" };
const request = { network: "Preprod", agentIdentifier: "our-agent", inputHash: "saved-hash", metadata: JSON.stringify({ taskId: key.taskId }) } as PaymentRequest;
const payment: ListedPayment = { id: "payment-1", createdAt: new Date().toISOString(), ...request, blockchainIdentifier: "blockchain-id" };
const pages = (payments: ListedPayment[]) => async function* () { yield* payments; };
async function agePending() {
  await db.query("UPDATE side_effect SET updated_at = now() - INTERVAL '61 seconds' WHERE status = 'pending'");
}
async function pending() {
  await createStore(db).createJournal(key.taskId, "terms", { request }, "paid");
  await db.query("INSERT INTO side_effect (task_id, event_id, action, status) VALUES ($1, '-', 'terms', 'pending')", [key.taskId]);
  await agePending();
}

test("partial-create HTTP 400 adopts the existing payment and never repeats the POST", async () => {
  await createStore(db).createJournal(key.taskId, "terms", { request }, "paid");
  let posts = 0;
  const remote: ListedPayment[] = [];
  const mps = createMpsClient({ baseUrl: "http://localhost:3012", token: "TEST_TOKEN", fetch: async (url, init) => {
    if (init?.method === "GET") {
      const cursor = new URL(String(url)).searchParams.get("cursorId");
      return Response.json({ status: "success", data: { Payments: cursor ? [payment] : remote } });
    }
    posts++; remote.push(payment);
    return Response.json({ error: { message: "Invalid input after partial create" } }, { status: 400 });
  } });
  await expect(createStore(db).once(key, () => mps.createPayment(request))).rejects.toThrow();
  await expect(createStore(db).once(key, () => mps.createPayment(request))).rejects.toThrow("pending");
  await agePending();
  expect(await reconcileTerms({ db, lock: { tryAcquire: async () => true, release: async () => {} }, taskId: key.taskId, payments: (scan) => mps.listPayments(scan) })).toBe("adopted");
  expect(await createStore(db).once(key, () => mps.createPayment(request))).toEqual(payment);
  expect(posts).toBe(1);
});

test("reconciliation scans inclusive cursor pages before clearing or adopting", async () => {
  await pending();
  const unrelated = { ...payment, id: "first", metadata: null };
  const cursors: (string | null)[] = [];
  const mps = createMpsClient({ baseUrl: "http://localhost:3012", token: "TEST_TOKEN", fetch: async (url, init) => {
    const query = new URL(String(url)).searchParams;
    expect(query.get("network")).toBe("Preprod");
    expect(query.get("filterPaymentSourceType")).toBe("Web3CardanoV2");
    expect(query.get("filterAgentIdentifier")).toBe("our-agent");
    expect(query.get("limit")).toBe("50");
    expect(init?.method).toBe("GET"); expect(init?.body).toBeUndefined();
    expect(init?.redirect).toBe("error"); expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("token")).toBe("TEST_TOKEN");
    const cursor = query.get("cursorId"); cursors.push(cursor);
    return Response.json({ status: "success", data: { Payments: cursor === null ? [...Array.from({ length: 49 }, (_, i) => ({ ...unrelated, id: `row-${i}` })), unrelated] : [unrelated, payment] } });
  } });
  await agePending();
  expect(await reconcileTerms({ db, lock: { tryAcquire: async () => true, release: async () => {} }, taskId: key.taskId, payments: (scan) => mps.listPayments(scan) })).toBe("adopted");
  expect(cursors).toEqual([null, "first"]);
});

test.each(["http", "malformed", "loop"])("unsafe payment listing %s does not clear pending", async (kind) => {
  await pending();
  let calls = 0;
  const mps = createMpsClient({ baseUrl: "http://localhost:3012", token: "TEST_TOKEN", fetch: async () => {
    calls++;
    if (kind === "http") return new Response("TOKEN", { status: 500 });
    if (kind === "malformed") return Response.json({ status: "success", data: {} });
    return Response.json({ status: "success", data: { Payments: calls === 1 ? Array.from({ length: 50 }, (_, i) => ({ ...payment, metadata: null, id: `row-${i}` })) : [{ ...payment, id: "row-0" }] } });
  } });
  await expect(reconcileTerms({ db, lock: { tryAcquire: async () => true, release: async () => {} }, taskId: key.taskId, payments: (scan) => mps.listPayments(scan) })).rejects.toThrow();
  expect((await db.query("SELECT status FROM side_effect")).rows).toEqual([{ status: "pending" }]);
});

test("no matching payment clears pending and permits the next poll to create", async () => {
  await pending();
  const unrelated = [{ ...payment, metadata: "different-task" }, { ...payment, id: "other", inputHash: "different-hash" }];
  expect(await reconcileTerms({ db, lock: { tryAcquire: async () => true, release: async () => {} }, taskId: key.taskId, payments: pages(unrelated) })).toBe("cleared");
  expect((await db.query("SELECT * FROM side_effect")).rows).toHaveLength(0);
  let posts = 0;
  await createStore(db).once(key, async () => { posts++; return payment; });
  expect(posts).toBe(1);
});

test("scan stops at saved terms time minus ten minutes", async () => {
  await pending();
  await db.query("UPDATE task_journal SET updated_at = '2026-10-06T10:00:00Z' WHERE task_id = $1", [key.taskId]);
  let calls = 0;
  const mps = createMpsClient({ baseUrl: "http://localhost:3012", token: "TEST_TOKEN", fetch: async () => {
    calls++;
    return Response.json({ status: "success", data: { Payments: [
      { ...payment, id: "boundary", metadata: null, createdAt: "2026-10-06T09:50:00Z" },
      { ...payment, createdAt: "2026-10-06T09:49:59Z" },
    ] } });
  } });
  expect(await reconcileTerms({ db, lock: { tryAcquire: async () => true, release: async () => {} }, taskId: key.taskId, payments: (scan) => {
    expect(scan.termsTimeMs).toBe(Date.parse("2026-10-06T10:00:00Z"));
    return mps.listPayments(scan);
  } })).toBe("cleared");
  expect(calls).toBe(1);
});

test("five full pages without reaching the cutoff leave pending unchanged", async () => {
  await pending();
  let calls = 0;
  const mps = createMpsClient({ baseUrl: "http://localhost:3012", token: "TEST_TOKEN", fetch: async (url) => {
    const cursor = new URL(String(url)).searchParams.get("cursorId");
    const first = cursor ? Number(cursor) : 0;
    calls++;
    return Response.json({ status: "success", data: { Payments: Array.from({ length: 50 }, (_, i) => ({ ...payment, id: String(first + i), metadata: null })) } });
  } });
  await expect(reconcileTerms({ db, lock: { tryAcquire: async () => true, release: async () => {} }, taskId: key.taskId, payments: (scan) => mps.listPayments(scan) })).rejects.toThrow("pagination limit");
  expect(calls).toBe(5);
  expect((await db.query("SELECT status FROM side_effect")).rows).toEqual([{ status: "pending" }]);
});

test.each([false, true])("absent or done side effect does not change or list payments (%s)", async (done) => {
  if (done) await createStore(db).once(key, async () => payment);
  const before = await db.query("SELECT * FROM side_effect");
  expect(await reconcileTerms({ db, lock: { tryAcquire: async () => true, release: async () => {} }, taskId: key.taskId, payments: async function* () { throw new Error("Must not list"); } })).toBe("not-pending");
  expect(await db.query("SELECT * FROM side_effect")).toEqual(before);
});

test("listing failure or multiple matches leaves pending unchanged", async () => {
  await pending();
  await expect(reconcileTerms({ db, lock: { tryAcquire: async () => true, release: async () => {} }, taskId: key.taskId, payments: async function* () { yield payment; throw new Error("Unavailable"); } })).rejects.toThrow();
  await expect(reconcileTerms({ db, lock: { tryAcquire: async () => true, release: async () => {} }, taskId: key.taskId, payments: pages([payment, { ...payment, id: "duplicate" }]) })).rejects.toThrow("Multiple");
  expect((await db.query("SELECT status FROM side_effect")).rows).toEqual([{ status: "pending" }]);
});

test.each([JSON.stringify({ taskId: "different-task", note: "reference task-reconcile" }),
  JSON.stringify({ taskId: "task-reconcile-other" }), "task-reconcile", "null", "[]", '"task-reconcile"'])
  ("foreign or malformed metadata is never adopted (%s)", async (metadata) => {
    await pending();
    expect(await reconcileTerms({ db, taskId: key.taskId, lock: { tryAcquire: async () => true, release: async () => {} },
      payments: pages([{ ...payment, metadata }]) })).toBe("cleared");
    expect((await db.query("SELECT * FROM side_effect")).rows).toHaveLength(0);
  });

test("recent pending row refuses recovery before listing and releases the lock", async () => {
  await pending();
  await db.query("UPDATE side_effect SET updated_at = now() - INTERVAL '59 seconds'");
  let released = false;
  const before = await db.query("SELECT * FROM side_effect");
  expect(await reconcileTerms({ db, taskId: key.taskId, lock: { tryAcquire: async () => true, release: async () => { released = true; } },
    payments: async function* () { throw new Error("Must not list"); } })).toBe("too-recent");
  expect(await db.query("SELECT * FROM side_effect")).toEqual(before);
  expect(released).toBe(true);
});

test("exclusive recovery cannot clear an in-flight Worker create or permit a second POST", async () => {
  let held = false;
  const lock = () => ({ tryAcquire: async () => { if (held) return false; held = true; return true; }, release: async () => { held = false; } });
  let finish!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const ready = new Promise<void>((resolve) => { started = resolve; });
  let posts = 0;
  const worker = withWorkerLock(lock(), async () => createStore(db).once(key, async () => {
    posts++; started(); await gate; return payment;
  }));
  await ready;
  try {
    await agePending(); // Even an old in-flight row remains protected by the session lock.
    expect(await reconcileTerms({ db, taskId: key.taskId, lock: lock(), payments: pages([]) })).toBe("worker-running");
    await expect(withWorkerLock(lock(), async () => { posts++; })).rejects.toThrow("holds the lock");
    expect((await db.query("SELECT status FROM side_effect")).rows).toEqual([{ status: "pending" }]);
  } finally { finish(); await worker; }
  expect(await createStore(db).once(key, async () => { posts++; return payment; })).toEqual(payment);
  expect(posts).toBe(1);
});

test("reconcile holds the shared lock during its scan and releases it on errors", async () => {
  await pending();
  let held = false;
  const lock = () => ({ tryAcquire: async () => { if (held) return false; held = true; return true; }, release: async () => { held = false; } });
  await expect(reconcileTerms({ db, taskId: key.taskId, lock: lock(), payments: async function* () {
    await expect(withWorkerLock(lock(), async () => {})).rejects.toThrow("holds the lock");
    throw new Error("listing failed");
  } })).rejects.toThrow("listing failed");
  expect(held).toBe(false);
  expect((await db.query("SELECT status FROM side_effect")).rows).toEqual([{ status: "pending" }]);
});
