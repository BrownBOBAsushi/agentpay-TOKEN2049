import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";
import { createSessionLock, withWorkerLock } from "./lock";
import { formatWorkerFailure } from "./errors";
import { spawnSync } from "node:child_process";

test("dedicated session acquires and releases the shared bigint advisory lock", async () => {
  const db = new PGlite();
  let connects = 0;
  let ends = 0;
  const lock = createSessionLock({ connect: async () => { connects++; },
    query: (sql, params) => db.query(sql, params), end: async () => { ends++; }, on: () => {} });
  try {
    expect(await lock.tryAcquire()).toBe(true);
    expect((await db.query("SELECT * FROM pg_locks WHERE locktype = 'advisory'")).rows).toHaveLength(1);
    await lock.release();
    expect((await db.query("SELECT * FROM pg_locks WHERE locktype = 'advisory'")).rows).toHaveLength(0);
    expect(connects).toBe(1); expect(ends).toBe(1);
  } finally { await db.close(); }
});

test("Worker exits with the fixed LockError and does no work when lock is held", async () => {
  let ran = false;
  const error = await withWorkerLock({ tryAcquire: async () => false, release: async () => {} }, async () => { ran = true; }).catch((error: unknown) => error);
  expect(formatWorkerFailure(error)).toBe("worker_failed LockError: another worker or reconcile holds the lock");
  expect(ran).toBe(false);
});

test.each([false, true])("Worker releases the lock on normal or failed exit (%s)", async (fail) => {
  let released = false;
  const result = withWorkerLock({ tryAcquire: async () => true, release: async () => { released = true; } }, async () => {
    expect(released).toBe(false);
    if (fail) throw new Error("test failure");
    return "done";
  });
  if (fail) await expect(result).rejects.toThrow("test failure");
  else await expect(result).resolves.toBe("done");
  expect(released).toBe(true);
});

test.each(["acquiring", "held"])("shared-instance reuse while %s cannot close or unfence its owner", async (phase) => {
  let connected!: () => void;
  const gate = new Promise<void>((resolve) => { connected = resolve; });
  let connects = 0;
  let ends = 0;
  let fenced = false;
  const lock = createSessionLock({ connect: async () => { connects++; await gate; },
    query: async (sql) => { fenced = sql.includes("pg_try_advisory_lock"); return { rows: [{ acquired: true }] }; },
    end: async () => { ends++; fenced = false; }, on: () => {} });
  const first = lock.tryAcquire();
  expect(lock.state).toBe("acquiring");
  if (phase === "held") { connected(); expect(await first).toBe(true); }
  await expect(lock.tryAcquire()).rejects.toMatchObject({ name: "LockError", message: "lock instance already in use" });
  await expect(withWorkerLock(lock, async () => { throw new Error("Must not run"); }))
    .rejects.toMatchObject({ name: "LockError", message: "lock instance already in use" });
  expect(connects).toBe(1); expect(ends).toBe(0); expect(lock.state).toBe(phase);
  if (phase === "acquiring") { connected(); expect(await first).toBe(true); }
  expect(fenced).toBe(true); expect(lock.state).toBe("held");
  await lock.release();
  expect(ends).toBe(1); expect(fenced).toBe(false); expect(lock.state).toBe("closed");
  await expect(lock.tryAcquire()).rejects.toThrow("lock instance already in use");
  expect(connects).toBe(1); expect(ends).toBe(1);
});

test("contention closes only the contender and reuse requires a new instance", async () => {
  let owner = false;
  const counts = [{ connects: 0, ends: 0 }, { connects: 0, ends: 0 }, { connects: 0, ends: 0 }];
  const make = (index: number) => createSessionLock({
    connect: async () => { counts[index].connects++; },
    query: async (sql) => {
      if (sql.includes("pg_try_advisory_lock")) { const acquired = !owner; if (acquired) owner = true; return { rows: [{ acquired }] }; }
      owner = false; return { rows: [] };
    }, end: async () => { counts[index].ends++; }, on: () => {},
  });
  const first = make(0); const second = make(1);
  expect(await first.tryAcquire()).toBe(true);
  expect(await second.tryAcquire()).toBe(false);
  expect(owner).toBe(true); expect(first.state).toBe("held"); expect(second.state).toBe("closed");
  expect(counts[0].ends).toBe(0); expect(counts[1].ends).toBe(1);
  await first.release();
  await expect(withWorkerLock(first, async () => {})).rejects.toThrow("lock instance already in use");
  expect(counts[0]).toEqual({ connects: 1, ends: 1 });
  const fresh = make(2);
  expect(await fresh.tryAcquire()).toBe(true);
  await fresh.release(); expect(owner).toBe(false);
});

test.each(["end", "error"])("owner session %s remains fatal after rejected shared-instance reuse", (event) => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { createSessionLock } from ${JSON.stringify(new URL("./lock.ts", import.meta.url).href)};
    const handlers = {};
    const lock = createSessionLock({ connect: async () => {}, query: async () => ({ rows: [{ acquired: true }] }),
      end: async () => {}, on: (event, listener) => { handlers[event] = listener; } });
    await lock.tryAcquire();
    try { await lock.tryAcquire(); } catch {}
    handlers[${JSON.stringify(event)}]();
    console.log("UNFENCED_SIDE_EFFECT");
  `], { encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stdout).not.toContain("UNFENCED_SIDE_EFFECT");
  expect(result.stderr).toBe("");
});
