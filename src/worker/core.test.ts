import { expect, test } from "vitest";
import { createCoreClient } from "./core";

const options = { origin: "https://api.preprod.sokosumi.com", apiKey: "KEY123" };

async function expectSanitized(promise: Promise<unknown>, message: string) {
  const error = await promise.then(() => { throw new Error("Expected rejection"); }, (error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  const failure = error as Error;
  expect(failure.message).toBe(message);
  expect(failure.message).not.toContain("KEY123");
  expect(failure.stack).not.toContain("KEY123");
  expect(failure.stack).not.toContain("Authorization");
  expect(failure.cause).toBeUndefined();
}

test.each(["me", "getTask", "listReadyTasks"] as const)("%s sanitizes HTTP 200 JSON decode failures", async (method) => {
  const core = createCoreClient({ ...options, fetch: async () => new Response("KEY123", { status: 200 }) });
  const result = method === "me" ? core.me() : method === "getTask" ? core.getTask("task-a") : core.listReadyTasks("coworker");
  await expectSanitized(result, "Core returned invalid JSON (HTTP 200)");
});

test("schema failures also use a fixed error without response contents", async () => {
  const core = createCoreClient({ ...options, fetch: async () => Response.json({ data: { id: "KEY123", status: null } }) });
  await expectSanitized(core.getTask("task-a"), "Core returned invalid response");
});

test.each(["GET", "POST"] as const)("%s sanitizes fetch messages and cause chains", async (method) => {
  const core = createCoreClient({ ...options, fetch: async () => {
    throw new Error("Authorization: Bearer KEY123", { cause: new Error("KEY123") });
  } });
  await expectSanitized(method === "GET" ? core.me() : core.postEvent("task-a", { status: "RUNNING" }), `Core ${method} transport failed`);
});

test.each([400, 500])("HTTP %s errors omit the response body", async (status) => {
  const core = createCoreClient({ ...options, fetch: async () => new Response("Authorization: Bearer KEY123", { status }) });
  await expectSanitized(core.me(), `Core GET HTTP ${status}`);
  await expectSanitized(core.postEvent("task-a", { status: "RUNNING" }), `Core POST HTTP ${status}`);
});
