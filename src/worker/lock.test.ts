import { PGlite } from "@electric-sql/pglite";
import { expect, test } from "vitest";
import { createSessionLock, withWorkerLock } from "./lock";
import { formatWorkerFailure } from "./errors";

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
