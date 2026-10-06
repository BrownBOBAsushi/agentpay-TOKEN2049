import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import type { Db } from "./db";
import { migrate } from "./migrate";
import { createStore } from "./store";
import { createMpsClient } from "./mps";
import type { PaymentRequest } from "./mps";
import { reconcileTerms } from "./reconcile";
import type { ListedPayment } from "./mps";

let database: PGlite;
let db: Db;
beforeAll(async () => { database = new PGlite(); db = { query: (text, params) => database.query(text, params) }; await migrate(db); }, 20_000);
beforeEach(async () => { await db.query("TRUNCATE side_effect, task_journal"); });
afterAll(async () => { await database?.close(); });
const key = { taskId: "task-reconcile", eventId: "-", action: "terms" };
const request = { network: "Preprod", agentIdentifier: "our-agent", inputHash: "saved-hash", metadata: JSON.stringify({ taskId: key.taskId }) } as PaymentRequest;
const payment: ListedPayment = { id: "payment-1", createdAt: new Date().toISOString(), ...request, blockchainIdentifier: "blockchain-id" };
const pages = (payments: ListedPayment[]) => async function* () { yield* payments; };
async function pending() {
  await createStore(db).createJournal(key.taskId, "terms", { request }, "paid");
  await db.query("INSERT INTO side_effect (task_id, event_id, action, status) VALUES ($1, '-', 'terms', 'pending')", [key.taskId]);
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
  expect(await reconcileTerms({ db, taskId: key.taskId, payments: (scan) => mps.listPayments(scan) })).toBe("adopted");
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
  expect(await reconcileTerms({ db, taskId: key.taskId, payments: (scan) => mps.listPayments(scan) })).toBe("adopted");
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
  await expect(reconcileTerms({ db, taskId: key.taskId, payments: (scan) => mps.listPayments(scan) })).rejects.toThrow();
  expect((await db.query("SELECT status FROM side_effect")).rows).toEqual([{ status: "pending" }]);
});

test("no matching payment clears pending and permits the next poll to create", async () => {
  await pending();
  const unrelated = [{ ...payment, metadata: "different-task" }, { ...payment, id: "other", inputHash: "different-hash" }];
  expect(await reconcileTerms({ db, taskId: key.taskId, payments: pages(unrelated) })).toBe("cleared");
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
  expect(await reconcileTerms({ db, taskId: key.taskId, payments: (scan) => {
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
  await expect(reconcileTerms({ db, taskId: key.taskId, payments: (scan) => mps.listPayments(scan) })).rejects.toThrow("pagination limit");
  expect(calls).toBe(5);
  expect((await db.query("SELECT status FROM side_effect")).rows).toEqual([{ status: "pending" }]);
});

test.each([false, true])("absent or done side effect does not change or list payments (%s)", async (done) => {
  if (done) await createStore(db).once(key, async () => payment);
  const before = await db.query("SELECT * FROM side_effect");
  expect(await reconcileTerms({ db, taskId: key.taskId, payments: async function* () { throw new Error("Must not list"); } })).toBe("not-pending");
  expect(await db.query("SELECT * FROM side_effect")).toEqual(before);
});

test("listing failure or multiple matches leaves pending unchanged", async () => {
  await pending();
  await expect(reconcileTerms({ db, taskId: key.taskId, payments: async function* () { yield payment; throw new Error("Unavailable"); } })).rejects.toThrow();
  await expect(reconcileTerms({ db, taskId: key.taskId, payments: pages([payment, { ...payment, id: "duplicate" }]) })).rejects.toThrow("Multiple");
  expect((await db.query("SELECT status FROM side_effect")).rows).toEqual([{ status: "pending" }]);
});
