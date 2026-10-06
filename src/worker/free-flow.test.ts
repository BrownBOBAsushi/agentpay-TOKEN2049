import { Address, KeyHash, PrivateKey } from "@evolution-sdk/evolution";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { verifyReceipt } from "../guard";
import bundle from "../guard/fixtures/bundle.valid.json";
import { loadConfig } from "./config";
import { createCoreClient } from "./core";
import { runFreeFlow } from "./free-flow";
import { runGuardTask } from "./guard-task";
import { pollOnce } from "./index";
import { migrate } from "./migrate";
import { createStore, SafeToRetryError, UncertainSideEffectError } from "./store";
import type { Db } from "./db";

// TEST ONLY: synthetic seed, never a wallet or funded key.
const privateKeyHex = "02".repeat(32);
const address = Address.toBech32(Address.fromHex(`60${KeyHash.toHex(KeyHash.fromPrivateKey(PrivateKey.fromHex(privateKeyHex)))}`));
const guardKey = { privateKeyHex, address };
const nowSec = bundle.mandate.expiry - 600;
const proposal = { kind: "x402", requirements: { scheme: "exact", network: "cardano:preprod", amount: "2000000", asset: "lovelace", payTo: "demo-agent", maxTimeoutSeconds: 600 } };
const description = JSON.stringify({ mandateBundle: bundle, proposal });
const env = { SOKOSUMI_API_URL: "https://api.preprod.sokosumi.com/v1", SOKOSUMI_COWORKER_API_KEY: "test-token", SOKOSUMI_COWORKER_ID: "coworker", DATABASE_URL: "postgres://unused/test", GUARD_SIGNING_KEY: privateKeyHex, GUARD_ADDRESS: address };
let database: PGlite;
let db: Db;
let store: ReturnType<typeof createStore>;

beforeAll(async () => {
  database = new PGlite();
  db = { query: (text, params) => database.query(text, params) };
  await migrate(db);
}, 20_000);
beforeEach(async () => {
  await db.query("TRUNCATE side_effect, mandate_nonce, task_journal");
  store = createStore(db);
});
afterAll(async () => { await database?.close(); });

function fakeCore() {
  const posts: { status: string; comment?: string }[] = [];
  const requests: { url: URL; init?: RequestInit }[] = [];
  const task = { id: "task-a", status: "READY", description, coworkerId: "coworker" };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      posts.push(body);
      task.status = body.status;
      return new Response(null, { status: 204 });
    }
    return Response.json({ data: url.pathname === "/v1/tasks" ? [task] : task });
  };
  return { core: createCoreClient({ origin: "https://api.preprod.sokosumi.com", apiKey: "test-token", fetch: fetcher }), posts, requests, task };
}

test("READY task posts RUNNING and one verifiable COMPLETED receipt", async () => {
  const fake = fakeCore();
  const tasks = await fake.core.listReadyTasks("coworker");
  await runFreeFlow({ task: tasks[0], core: fake.core, store, guardKey, nowSec });
  await runFreeFlow({ task: fake.task, core: fake.core, store, guardKey, nowSec });
  expect(fake.posts.map((p) => p.status)).toEqual(["RUNNING", "COMPLETED"]);
  const signed = JSON.parse(fake.posts[1].comment!);
  expect(verifyReceipt(signed, address)).toBe(true);
  expect(signed.receipt.verdict).toBe("APPROVE");
  expect(fake.requests[0].url.searchParams.get("status")).toBe("READY");
  expect(fake.requests[0].url.searchParams.get("coworkerId")).toBe("coworker");
  for (const request of fake.requests) {
    expect(new Headers(request.init?.headers).get("Authorization")).toBe("Bearer test-token");
    expect(request.init?.redirect).toBe("error");
    expect(request.init?.signal).toBeInstanceOf(AbortSignal);
  }
});

test("restart after check reuses exact journal string without another check", async () => {
  const fake = fakeCore();
  let fail = true;
  const interrupted: Db = { query: (text, params) => {
    if (fail && text.includes("INSERT INTO side_effect") && params?.[2] === "complete") { fail = false; throw new Error("Simulated stop"); }
    return db.query(text, params);
  } };
  await expect(runFreeFlow({ task: fake.task, core: fake.core, store: createStore(interrupted), guardKey, nowSec })).rejects.toThrow("Simulated stop");
  const journal = await store.readJournal("task-a");
  expect(journal?.stage).toBe("check");
  expect(typeof journal?.data).toBe("string");
  await runFreeFlow({ task: fake.task, core: fake.core, store: createStore(db), guardKey, nowSec: nowSec + 1 });
  expect(fake.posts.map((p) => p.status)).toEqual(["RUNNING", "COMPLETED"]);
  expect(fake.posts[1].comment).toBe(journal?.data);
  expect(JSON.parse(fake.posts[1].comment!).receipt.ts).toBe(nowSec);
});

test("crash after RUNNING post leaves uncertainty and never reposts", async () => {
  const fake = fakeCore();
  const interrupted: Db = { query: (text, params) => {
    if (text.includes("UPDATE side_effect") && params?.[2] === "start") throw new Error("Simulated crash");
    return db.query(text, params);
  } };
  await expect(runFreeFlow({ task: fake.task, core: fake.core, store: createStore(interrupted), guardKey, nowSec })).rejects.toThrow();
  await expect(runFreeFlow({ task: fake.task, core: fake.core, store, guardKey, nowSec })).rejects.toBeInstanceOf(UncertainSideEffectError);
  expect(fake.posts).toEqual([{ status: "RUNNING" }]);
});

test("RUNNING without a journal is left alone", async () => {
  const fake = fakeCore();
  fake.task.status = "RUNNING";
  const logs: string[] = [];
  await runFreeFlow({ task: fake.task, core: fake.core, store, guardKey, nowSec, log: (stage) => logs.push(stage) });
  expect(fake.posts).toEqual([]);
  expect(logs).toEqual(["unowned"]);
});

test("S2 completes with two field diffs and does not consume the nonce", async () => {
  const fake = fakeCore();
  fake.task.description = JSON.stringify({ mandateBundle: bundle, proposal: { ...proposal, requirements: { ...proposal.requirements, payTo: "attacker", amount: "9000000" } } });
  await runFreeFlow({ task: fake.task, core: fake.core, store, guardKey, nowSec });
  const signed = JSON.parse(fake.posts[1].comment!);
  expect(verifyReceipt(signed, address)).toBe(true);
  expect(signed.receipt.verdict).toBe("REFUSE");
  expect(signed.receipt.diff.map((entry: { field: string }) => entry.field)).toEqual(["payee", "amount"]);
  expect(await store.isNonceUsed(bundle.mandate.payer, bundle.mandate.nonce, "task-b")).toBe(false);
});

test("second task using an approved Mandate is refused", async () => {
  await runGuardTask({ taskId: "task-a", description, nowSec, store, guardKey });
  const signed = JSON.parse(await runGuardTask({ taskId: "task-b", description, nowSec, store, guardKey }));
  expect(signed.receipt.reasons).toEqual(["NONCE_REUSED"]);
  expect(verifyReceipt(signed, address)).toBe(true);
});

test.each(["not JSON", "null", "{}"])("malformed description returns a signed refusal: %s", async (description) => {
  const signed = JSON.parse(await runGuardTask({ taskId: "task-a", description, nowSec, store, guardKey }));
  expect(signed.receipt.reasons).toEqual(["PROPOSAL_INVALID"]);
  expect(verifyReceipt(signed, address)).toBe(true);
});

test("config normalizes /v1 and defaults to a 10-second interval", () => {
  expect(loadConfig(env).origin).toBe("https://api.preprod.sokosumi.com");
  expect(loadConfig(env).pollIntervalMs).toBe(10000);
});
test.each([
  { SOKOSUMI_API_URL: "https://api.sokosumi.com" },
  { SOKOSUMI_API_URL: "http://api.preprod.sokosumi.com" },
  { GUARD_ADDRESS: Address.toBech32(Address.fromHex(`61${"00".repeat(28)}`)) },
  { POLL_INTERVAL_MS: "9999" },
])("config rejects unsafe setting %# without exposing values", (change) => {
  expect(() => loadConfig({ ...env, ...change })).toThrow("Invalid Worker configuration");
});

test("only GET 4xx is classified safe to retry", async () => {
  const core = createCoreClient({ origin: "https://api.preprod.sokosumi.com", apiKey: "test-token", fetch: async () => new Response("private error body", { status: 400 }) });
  await expect(core.me()).rejects.toBeInstanceOf(SafeToRetryError);
  const failure = core.postEvent("task-a", { status: "RUNNING" });
  await expect(failure).rejects.toThrow("Core POST HTTP 400");
  await expect(failure).rejects.not.toBeInstanceOf(SafeToRetryError);
});

test("polling recovers a checked journal even when READY listing is empty", async () => {
  const result = await runGuardTask({ taskId: "task-a", description, nowSec, store, guardKey });
  await store.writeJournal("task-a", "check", result);
  const posts: unknown[] = [];
  const core = createCoreClient({ origin: env.SOKOSUMI_API_URL, apiKey: "test-token", fetch: async (input, init) => {
    if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return new Response(null, { status: 204 }); }
    return Response.json({ data: new URL(String(input)).pathname === "/v1/tasks" ? [] : { id: "task-a", status: "RUNNING", description, coworkerId: "coworker" } });
  } });
  await pollOnce({ db, core, coworkerId: "coworker", guardKey, nowSec: () => nowSec + 1, stopping: () => false, log: () => {} });
  expect(posts).toEqual([{ status: "COMPLETED", comment: result }]);
});

test("shutdown stops before a Task starts", async () => {
  const fake = fakeCore();
  await pollOnce({ db, core: fake.core, coworkerId: "coworker", guardKey, nowSec: () => nowSec, stopping: () => true, log: () => {} });
  expect(fake.posts).toEqual([]);
});

test("concurrent tasks using one Mandate produce only one APPROVE", async () => {
  const results = await Promise.all(["task-a", "task-b"].map((taskId) => runGuardTask({ taskId, description, nowSec, store, guardKey })));
  const receipts = results.map((result) => JSON.parse(result).receipt);
  expect(receipts.map((receipt) => receipt.verdict).sort()).toEqual(["APPROVE", "REFUSE"]);
  expect(receipts.find((receipt) => receipt.verdict === "REFUSE").reasons).toEqual(["NONCE_REUSED"]);
});

test("Core pagination follows cursor metadata on the pinned origin", async () => {
  const urls: URL[] = [];
  const core = createCoreClient({ origin: env.SOKOSUMI_API_URL, apiKey: "test-token", fetch: async (input) => {
    const url = new URL(String(input)); urls.push(url);
    const second = url.searchParams.has("cursor");
    return Response.json({ data: [{ id: second ? "task-b" : "task-a", status: "READY", description }], meta: { pagination: { nextCursor: second ? null : "next" } } });
  } });
  expect((await core.listReadyTasks("coworker")).map((task) => task.id)).toEqual(["task-a", "task-b"]);
  expect(urls[1].searchParams.get("cursor")).toBe("next");
  expect(urls.every((url) => url.origin === "https://api.preprod.sokosumi.com")).toBe(true);
});
