import type { Pool, PoolClient } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { createStorePaymentDb } from "./store-payment-db.server";

vi.mock("server-only", () => ({}));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function fixture() {
  const query = vi.fn(async () => ({ rows: [] }));
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const pool = { connect } as unknown as Pick<Pool, "connect">;
  return { client, query, release, connect, db: createStorePaymentDb(pool) };
}
it("a queued pool acquisition times out within the remaining budget and destroys its late checkout", async () => {
  const f = fixture(); let finish!: (client: PoolClient) => void;
  f.connect.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  vi.useFakeTimers();
  const stopped = expect(f.db.query("SELECT state", [], { deadlineMs: Date.now() + 1000 })).rejects.toThrow("payment request deadline reached");
  await vi.advanceTimersByTimeAsync(1000); await stopped;
  finish(f.client); await vi.advanceTimersByTimeAsync(0);
  expect(f.query).not.toHaveBeenCalled(); expect(f.release.mock.calls).toEqual([[true]]);
});
it("a checkout that resolves at the cutoff is destroyed before it can issue a query", async () => {
  const f = fixture(); const deadlineMs = Date.now() + 1000;
  f.connect.mockImplementationOnce(async () => { vi.spyOn(Date, "now").mockReturnValue(deadlineMs); return f.client; });
  await expect(f.db.query("SELECT state", [], { deadlineMs })).rejects.toThrow("payment request deadline reached");
  expect(f.query).not.toHaveBeenCalled(); expect(f.release.mock.calls).toEqual([[true]]);
});
it("query timeout uses the budget left after acquisition and destroys the timed-out connection", async () => {
  const f = fixture(); let finish!: (value: { rows: never[] }) => void;
  f.query.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  let now = Date.now(); const deadlineMs = now + 1000;
  vi.useFakeTimers(); vi.spyOn(Date, "now").mockImplementation(() => now);
  f.connect.mockImplementationOnce(async () => { now += 400; return f.client; });
  const stopped = expect(f.db.query("UPDATE store_payments", [], { deadlineMs })).rejects.toThrow("payment request deadline reached");
  await vi.advanceTimersByTimeAsync(0);
  expect(f.query).toHaveBeenCalledWith({ text: "UPDATE store_payments", values: [], query_timeout: 600 });
  now = deadlineMs; await vi.advanceTimersByTimeAsync(600); await stopped;
  expect(f.release.mock.calls).toEqual([[true]]);
  finish({ rows: [] }); await vi.advanceTimersByTimeAsync(0);
  expect(f.release).toHaveBeenCalledTimes(1);
});
it("a completed query at the cutoff preserves its ambiguous result and destroys the connection", async () => {
  const f = fixture(); const deadlineMs = Date.now() + 1000;
  f.query.mockImplementationOnce(async () => { vi.spyOn(Date, "now").mockReturnValue(deadlineMs); return { rows: [] }; });
  await expect(f.db.query("UPDATE store_payments", [], { deadlineMs })).rejects.toThrow("payment request deadline reached");
  expect(f.release.mock.calls).toEqual([[true]]); expect(f.query).toHaveBeenCalledTimes(1);
});
it("a successful query returns its client to the pool and keeps the fixed cap when the budget is longer", async () => {
  const f = fixture();
  await expect(f.db.query("SELECT state", [], { deadlineMs: Date.now() + 90_000 })).resolves.toEqual({ rows: [] });
  expect(f.query).toHaveBeenCalledWith({ text: "SELECT state", values: [], query_timeout: 10_000 });
  expect(f.release.mock.calls).toEqual([[false]]);
});
