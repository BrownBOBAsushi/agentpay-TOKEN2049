import { createHash } from "node:crypto";
import { Address, KeyHash, PrivateKey } from "@evolution-sdk/evolution";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import bundle from "../guard/fixtures/bundle.valid.json";
import { verifyReceipt } from "../guard";
import { createCoreClient } from "./core";
import { createMpsClient } from "./mps";
import { advancePaidTask } from "./paid-flow";
import type { PaidTerms } from "./paid-flow";
import { reconcileTerms } from "./reconcile";
import { createStore, UncertainSideEffectError } from "./store";
import { migrate } from "./migrate";
import { loadConfig } from "./config";
import { formatWorkerFailure } from "./errors";
import { pollOnce, taskMode } from "./index";
import waiting from "./fixtures/mps-resolve-waiting.json";
import sellerReturnError from "./fixtures/mps-payment-400-seller-return.json";
import type { Db } from "./db";

// TEST ONLY: fixed synthetic Guard key; never funded or used as a wallet.
const privateKeyHex = "02".repeat(32);
const address = Address.toBech32(Address.fromHex(`60${KeyHash.toHex(KeyHash.fromPrivateKey(PrivateKey.fromHex(privateKeyHex)))}`));
const guardKey = { privateKeyHex, address };
const description = JSON.stringify({ mandateBundle: bundle, proposal: { kind: "x402", requirements: { scheme: "exact", network: "cardano:preprod", amount: "2000000", asset: "lovelace", payTo: "demo-agent", maxTimeoutSeconds: 1 } } });
const unit = "a".repeat(56) + "00";
const paid = { agentIdentifier: "agent", supportedPaymentSourceIndex: 0, tusdmUnit: unit };
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
let database: PGlite;
let db: Db;
beforeAll(async () => { database = new PGlite(); db = { query: (text, params) => database.query(text, params) }; await migrate(db); }, 20_000);
beforeEach(async () => { await db.query("TRUNCATE side_effect, mandate_nonce, task_journal"); });
afterAll(async () => { await database?.close(); });

function setup(resolveState?: Record<string, unknown>, deadlines?: PaidTerms["deadlines"]) {
  let createStatus = 200;
  let nowSec = bundle.mandate.expiry - 600;
  let locked = true;
  let confirmed = true;
  let resultMatches = true;
  let submittedHash = "";
  let result = "";
  const events: string[] = [];
  const logs: string[] = [];
  let created: Record<string, unknown> = {};
  let payment: Record<string, unknown> = {};
  let alterPayment = (value: Record<string, unknown>) => value;
  const task = { id: "task-paid", status: "READY", description, coworkerId: "coworker" };
  const core = createCoreClient({ origin: "https://api.preprod.sokosumi.com", apiKey: "test-core-token", fetch: async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/receipt")) return Response.json({ data: { settled: true, txHash: "collection-tx" } });
    const body = JSON.parse(String(init?.body));
    events.push(body.masumiPayment ? "masumiPayment" : body.status);
    if (body.status) task.status = body.status;
    if (body.status === "COMPLETED") result = body.comment;
    if (body.masumiPayment) {
      expect(body.masumiPayment.Amounts).toEqual([{ amount: "1000000", unit }]);
      expect(body.masumiPayment.sellerVkey).toBe("seller-vkey");
      expect(body.masumiPayment.identifierFromPurchaser).toBe(created.identifierFromPurchaser);
      expect(body.masumiPayment.PaymentSource.network).toBe("Preprod");
    }
    return new Response(null, { status: 204 });
  } });
  const mps = createMpsClient({ baseUrl: "http://127.0.0.1:3012/api/v1", token: "test-mps-token", fetch: async (input, init) => {
    expect(new Headers(init?.headers).get("token")).toBe("test-mps-token");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const path = new URL(String(input)).pathname;
    if (init?.method === "GET") return Response.json({ status: "success", data: { Payments: [payment] } });
    const body = JSON.parse(String(init?.body));
    expect(body.network).toBe("Preprod");
    if (path === "/api/v1/payment") {
      events.push("createPayment"); created = body;
      if (createStatus === 0) throw new DOMException("test-mps-token", "TimeoutError");
      const journal = await createStore(db).readJournal<{ request: Record<string, unknown> }>(task.id);
      expect(journal?.data.request.identifierFromPurchaser).toBe(body.identifierFromPurchaser);
      payment = alterPayment({ ...body, id: "payment-id", createdAt: new Date().toISOString(), blockchainIdentifier: "blockchain-id", sellerReturnAddress: null,
        PaymentSource: { network: "Preprod", paymentSourceType: "Web3CardanoV2", smartContractAddress: "escrow", policyId: "policy" },
        SmartContractWallet: { id: "seller", walletVkey: "seller-vkey" } });
      if (createStatus !== 200) return Response.json(sellerReturnError, { status: createStatus });
      return Response.json({ status: "success", data: payment });
    }
    if (path.endsWith("/submit-result")) { events.push("submit-result"); submittedHash = body.submitResultHash; return Response.json({ status: "success", data: {} }); }
    expect(path).toBe("/api/v1/payment/resolve-blockchain-identifier");
    expect(body).toEqual({ network: "Preprod", blockchainIdentifier: "blockchain-id", includeHistory: "true" });
    if (resolveState) return Response.json({ status: "success", data: resolveState });
    const state = submittedHash ? "ResultSubmitted" : locked ? "FundsLocked" : "Pending";
    return Response.json({ status: "success", data: { onChainState: state, resultHash: resultMatches ? submittedHash : "other", CurrentTransaction: { status: confirmed ? "Confirmed" : "Pending", newOnChainState: state } } });
  } });
  const advance = (storeDb: Db = db) => advancePaidTask({ task, core, mps, store: createStore(storeDb), guardKey, paid: { ...paid, deadlines }, nowSec, log: (stage) => logs.push(stage) });
  return { advance, events, logs, task, core, mps, setTime: (value: number) => { nowSec = value; },
    setCreateStatus: (value: number) => { createStatus = value; },
    setLocked: (value: boolean) => { locked = value; }, setConfirmed: (value: boolean) => { confirmed = value; }, setResultMatches: (value: boolean) => { resultMatches = value; },
    alter: (fn: typeof alterPayment) => { alterPayment = fn; }, snapshot: () => ({ created, payment, result, submittedHash }) };
}

test("paid happy path preserves hashes, order, once keys, and settlement", async () => {
  const flow = setup();
  for (let i = 0; i < 12; i++) await flow.advance();
  expect(flow.events).toEqual(["RUNNING", "createPayment", "masumiPayment", "submit-result", "COMPLETED"]);
  const { created, result, submittedHash } = flow.snapshot();
  expect(created.inputHash).toBe(sha(description));
  expect(created.identifierFromPurchaser).toMatch(/^[0-9a-f]{20}$/);
  expect(created.RequestedFunds).toEqual([{ amount: "1000000", unit }]);
  for (const [field, minutes] of Object.entries({ payByTime: 20, submitResultTime: 60, unlockTime: 75, externalDisputeUnlockTime: 90 })) {
    expect(Date.parse(created[field] as string)).toBe((bundle.mandate.expiry - 600 + minutes * 60) * 1000);
  }
  expect(submittedHash).toBe(sha(result));
  expect(verifyReceipt(JSON.parse(result), address)).toBe(true);
  expect((await createStore(db).readJournal(flow.task.id))?.stage).toBe("settled");
  expect((await createStore(db).readJournal<{ settlement: unknown }>(flow.task.id))?.data.settlement).toEqual({ settled: true, txHash: "collection-tx" });
});

test.each(["start", "terms", "masumi-payment", "await-escrow", "check", "submit-result", "await-result", "complete", "await-settlement", "settled"])("restart after persisting %s does not repeat POSTs", async (stage) => {
  const flow = setup();
  let crashed = false;
  const crashDb: Db = { query: async <T>(text: string, params?: unknown[]) => {
    const result = await db.query<T>(text, params);
    if (!crashed && text.includes("INSERT INTO task_journal") && params?.[1] === stage) { crashed = true; throw new Error("Simulated restart"); }
    return result;
  } };
  for (let i = 0; i < 12 && !crashed; i++) {
    try { await flow.advance(crashDb); } catch (error) { expect((error as Error).message).toBe("Simulated restart"); }
  }
  expect(crashed).toBe(true);
  for (let i = 0; i < 12; i++) await flow.advance();
  expect(flow.events).toEqual(["RUNNING", "createPayment", "masumiPayment", "submit-result", "COMPLETED"]);
});

test.each(["amount", "unit", "network", "sellerReturnAddress", "forceLayer"])("invalid payment %s prevents masumiPayment post", async (field) => {
  const flow = setup();
  flow.alter((payment) => ({ ...payment,
    ...(field === "amount" ? { RequestedFunds: [{ amount: "2", unit }] } : {}),
    ...(field === "unit" ? { RequestedFunds: [{ amount: "1000000", unit: "other" }] } : {}),
    ...(field === "network" ? { PaymentSource: { ...(payment.PaymentSource as object), network: "Mainnet" } } : {}),
    ...(field === "sellerReturnAddress" ? { sellerReturnAddress: "other" } : {}),
    ...(field === "forceLayer" ? { forceLayer: "L1" } : {}),
  }));
  await flow.advance(); await flow.advance();
  await expect(flow.advance()).rejects.toThrow();
  expect(flow.events).toEqual(["RUNNING", "createPayment"]);
});

test("escrow deadline stops without running the Guard Check", async () => {
  const flow = setup(waiting);
  for (let i = 0; i < 4; i++) await flow.advance();
  flow.setTime(bundle.mandate.expiry - 600 + 1799);
  await flow.advance();
  expect((await createStore(db).readJournal(flow.task.id))?.stage).toBe("await-escrow");
  flow.setTime(bundle.mandate.expiry - 600 + 1800);
  await flow.advance();
  expect(flow.events).toEqual(["RUNNING", "createPayment", "masumiPayment"]);
  expect((await db.query("SELECT * FROM mandate_nonce")).rows).toHaveLength(0);
  expect((await createStore(db).readJournal(flow.task.id))?.stage).toBe("failed");
  expect(flow.logs).toContain("payment_deadline_expired");
});

test("null on-chain state keeps waiting for escrow without running the Guard Check", async () => {
  const flow = setup(waiting);
  for (let i = 0; i < 6; i++) await expect(flow.advance()).resolves.toBeUndefined();
  expect((await createStore(db).readJournal(flow.task.id))?.stage).toBe("await-escrow");
  expect(flow.events).toEqual(["RUNNING", "createPayment", "masumiPayment"]);
  expect((await db.query("SELECT * FROM side_effect WHERE action = 'check'")).rows).toHaveLength(0);
  expect((await db.query("SELECT * FROM mandate_nonce")).rows).toHaveLength(0);
});

test("unconfirmed escrow and wrong result hash cannot advance", async () => {
  const flow = setup(); flow.setConfirmed(false);
  for (let i = 0; i < 5; i++) await flow.advance();
  expect((await createStore(db).readJournal(flow.task.id))?.stage).toBe("await-escrow");
  flow.setConfirmed(true);
  for (let i = 0; i < 3; i++) await flow.advance();
  flow.setResultMatches(false); await flow.advance();
  expect(flow.events).not.toContain("COMPLETED");
});

test("uncertain terms POST is not retried", async () => {
  const flow = setup(); await flow.advance();
  const broken: Db = { query: (text, params) => { if (text.includes("UPDATE side_effect") && params?.[2] === "terms") throw new Error("Lost done write"); return db.query(text, params); } };
  await expect(flow.advance(broken)).rejects.toThrow();
  await expect(flow.advance()).rejects.toBeInstanceOf(UncertainSideEffectError);
  expect(flow.events).toEqual(["RUNNING", "createPayment"]);
});

test("saved mode wins over the flag in either direction", () => {
  expect(taskMode({ mode: "free" }, true)).toBe("free");
  expect(taskMode({ mode: "paid" }, false)).toBe("paid");
  expect(taskMode(null, false)).toBe("free");
  expect(taskMode(null, true)).toBe("paid");
});

test("journal mode is immutable across updates and legacy mode stays free", async () => {
  const store = createStore(db);
  await store.createJournal("free", "ready", {}, "free");
  await store.writeJournal("free", "check", "exact result", "paid");
  expect((await store.readJournal("free"))?.mode).toBe("free");
  await store.createJournal("paid", "start", {}, "paid");
  await store.writeJournal("paid", "terms", {});
  expect((await store.readJournal("paid"))?.mode).toBe("paid");
});

test("submission deadline prevents the Guard Check even after escrow locks", async () => {
  const flow = setup();
  for (let i = 0; i < 4; i++) await flow.advance();
  expect((await createStore(db).readJournal(flow.task.id))?.stage).toBe("check");
  flow.setTime(bundle.mandate.expiry - 600 + 3600);
  await flow.advance();
  expect((await db.query("SELECT * FROM mandate_nonce")).rows).toHaveLength(0);
  expect(flow.events).not.toContain("submit-result");
  expect(flow.logs).toContain("result_deadline_expired");
});

test("paid config requires named settings and remains available with the flag off", () => {
  const env = { SOKOSUMI_API_URL: "https://api.preprod.sokosumi.com", SOKOSUMI_COWORKER_API_KEY: "test-token", SOKOSUMI_COWORKER_ID: "coworker",
    DATABASE_URL: "postgres://unused/test", GUARD_SIGNING_KEY: privateKeyHex, GUARD_ADDRESS: address, PAID_TASKS_ENABLED: "true" };
  expect(() => loadConfig(env)).toThrow("MPS_RUNTIME_TOKEN");
  const full = { ...env, MPS_BASE_URL: "http://localhost:3012", MPS_RUNTIME_TOKEN: "test-token", MASUMI_AGENT_IDENTIFIER: "agent", MASUMI_SUPPORTED_PAYMENT_SOURCE_INDEX: "0", TUSDM_UNIT: unit };
  expect(loadConfig(full).paidTasksEnabled).toBe(true);
  expect(loadConfig(full).paid?.deadlines).toEqual({ payBy: 20, submitResult: 60, unlock: 75, dispute: 90 });
  expect(loadConfig({ ...full, PAID_PAY_BY_MINUTES: "25", PAID_SUBMIT_RESULT_MINUTES: "65", PAID_UNLOCK_MINUTES: "80", PAID_DISPUTE_MINUTES: "100" }).paid?.deadlines)
    .toEqual({ payBy: 25, submitResult: 65, unlock: 80, dispute: 100 });
  for (const value of ["60", "61", "0", "-1", "1.5", "NaN", "Infinity", "1e1", "9007199254740992"]) {
    expect(() => loadConfig({ ...full, PAID_PAY_BY_MINUTES: value })).toThrow("PAID_");
  }
  expect(() => loadConfig({ ...full, PAID_UNLOCK_MINUTES: "90" })).toThrow("PAID_DISPUTE_MINUTES");
  expect(loadConfig({ ...full, PAID_TASKS_ENABLED: "false" }).paid).toMatchObject(paid);
});

test.each(["FundsOrDatumInvalid", "Withdrawn", "RefundWithdrawn", "DisputedWithdrawn"])("terminal escrow state %s is saved as the failure reason", async (onChainState) => {
  const flow = setup({ ...waiting, onChainState });
  for (let i = 0; i < 4; i++) await flow.advance();
  expect(await createStore(db).readJournal(flow.task.id)).toMatchObject({ stage: "failed", data: { failure: onChainState } });
  expect(flow.events).not.toContain("submit-result");
});

test("confirmed lock after the grace period still advances", async () => {
  const flow = setup();
  for (let i = 0; i < 3; i++) await flow.advance();
  flow.setTime(bundle.mandate.expiry - 600 + 1801);
  await flow.advance();
  expect((await createStore(db).readJournal(flow.task.id))?.stage).toBe("check");
});

test.each([400, 500, 401, 0])("create-payment failure %s controls retry and blocked diagnostics", async (status) => {
  const flow = setup(); flow.setCreateStatus(status);
  const lines: string[] = [];
  const poll = () => pollOnce({ db, core: { ...flow.core, listReadyTasks: async () => [flow.task], getTask: async () => flow.task },
    coworkerId: "coworker", guardKey, nowSec: () => bundle.mandate.expiry - 600, stopping: () => false,
    paidTasksEnabled: true, paid, mps: flow.mps, log: (stage, id, detail) => lines.push(`${stage} ${id}${detail ? ` ${detail}` : ""}`) });
  await poll(); await poll();
  expect(lines.at(-1)).toBe(status === 0 ? "blocked task-paid WorkerError: MPS transport failed"
    : `blocked task-paid WorkerError: MPS HTTP ${status}: sellerReturnAddress must be`);
  expect(lines.join("\n")).not.toContain("test-mps-token");
  const rows = (await db.query("SELECT status FROM side_effect WHERE action = 'terms'")).rows;
  expect(rows).toEqual([{ status: "pending" }]);
  flow.setCreateStatus(200); await poll();
  expect(flow.events.filter((event) => event === "createPayment")).toHaveLength(1);
  expect((await createStore(db).readJournal(flow.task.id))?.stage).toBe("terms");
});

test("custom deadline offsets are persisted in the payment request", async () => {
  const flow = setup(undefined, { payBy: 25, submitResult: 65, unlock: 80, dispute: 100 });
  await flow.advance(); await flow.advance();
  const { created } = flow.snapshot();
  for (const [field, minutes] of Object.entries({ payByTime: 25, submitResultTime: 65, unlockTime: 80, externalDisputeUnlockTime: 100 })) {
    expect(Date.parse(created[field] as string)).toBe((bundle.mandate.expiry - 600 + minutes * 60) * 1000);
  }
});

test("an adopted partial-create payment completes the paid flow without a second create POST", async () => {
  const flow = setup(); flow.setCreateStatus(400);
  await flow.advance();
  await expect(flow.advance()).rejects.toThrow("MPS HTTP 400");
  expect(await reconcileTerms({ db, taskId: flow.task.id, payments: (scan) => flow.mps.listPayments(scan) })).toBe("adopted");
  for (let i = 0; i < 12; i++) await flow.advance();
  expect(flow.events).toEqual(["RUNNING", "createPayment", "masumiPayment", "submit-result", "COMPLETED"]);
  expect((await createStore(db).readJournal(flow.task.id))?.stage).toBe("settled");
});

test("config errors name only invalid keys and fatal output suppresses raw causes", () => {
  try { loadConfig({ SOKOSUMI_API_URL: "SECRET123", GUARD_SIGNING_KEY: "SECRET123" }); }
  catch (error) {
    const message = formatWorkerFailure(error);
    expect(message).toContain("SOKOSUMI_API_URL"); expect(message).toContain("GUARD_SIGNING_KEY"); expect(message).not.toContain("SECRET123");
  }
  expect(formatWorkerFailure(new Error("SECRET123", { cause: new Error("SECRET123") }))).not.toContain("SECRET123");
});
