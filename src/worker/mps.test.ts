import { expect, test } from "vitest";
import { createMpsClient, mpsBaseUrl } from "./mps";
import type { PaymentRequest } from "./mps";
import { formatWorkerFailure, workerErrorDetail } from "./errors";
import { SafeToRetryError } from "./store";

const options = { baseUrl: "http://127.0.0.1:3012/api/v1", token: "TEST_SECRET" };
test.each(["http://example.com", "http://127.0.0.1.example.com", "https://user:TEST_SECRET@example.com", "ftp://localhost", "https://example.com/other", "https://example.com?token=TEST_SECRET"])("rejects unsafe MPS URL %#", (baseUrl) => {
  expect(() => mpsBaseUrl(baseUrl)).toThrow("Invalid MPS base URL");
});

test("MPS diagnostics redact the token and request, remove line breaks, and cap server text at 200 characters", async () => {
  const request = { network: "Preprod", privateField: "REQUEST_ONLY" } as unknown as PaymentRequest;
  const message = `sellerReturnAddress must be null\n${options.token} ${JSON.stringify(request)} ${"x".repeat(250)}`;
  const mps = createMpsClient({ ...options, fetch: async () => Response.json({ status: "error", error: { message } }, { status: 400 }) });
  const error = await mps.createPayment(request).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(SafeToRetryError);
  expect((error as Error).message).toHaveLength("MPS HTTP 400: ".length + 200);
  const line = `blocked task-id ${workerErrorDetail(error)}`;
  expect(line).toContain("SafeToRetryError: MPS HTTP 400: sellerReturnAddress must be null");
  for (const sensitive of [options.token, "REQUEST_ONLY", "\n"]) expect(line).not.toContain(sensitive);
  expect((error as Error).stack).not.toContain(options.token);
  expect((error as Error).cause).toBeUndefined();
});

test("HTTP 400 resolving a payment remains uncertain", async () => {
  const mps = createMpsClient({ ...options, fetch: async () => Response.json({ error: { message: "Rejected" } }, { status: 400 }) });
  await expect(mps.resolve("blockchain-id")).rejects.not.toBeInstanceOf(SafeToRetryError);
});
test.each(["http://localhost:3012", "http://127.0.0.1:3012/api/v1", "http://[::1]:3012", "https://mps.example.com/api/v1/"])("allows loopback HTTP or remote HTTPS %#", (baseUrl) => {
  expect(mpsBaseUrl(baseUrl)).toMatch(/\/api\/v1$/);
});
test("rejects non-Preprod create requests before calling fetch", async () => {
  let calls = 0;
  const mps = createMpsClient({ ...options, fetch: async () => { calls += 1; return Response.json({ status: "success", data: {} }); } });
  await expect(mps.createPayment({ network: "Mainnet" } as unknown as PaymentRequest)).rejects.toThrow("MPS requires Preprod");
  expect(calls).toBe(0);
});
test.each(["decode", "envelope", "http", "transport"])("sanitizes %s failures with no token, response text, or cause", async (kind) => {
  const mps = createMpsClient({ ...options, fetch: async () => {
    if (kind === "transport") throw new Error("TEST_SECRET", { cause: new Error("TEST_SECRET") });
    if (kind === "http") return new Response("TEST_SECRET", { status: 400 });
    if (kind === "envelope") return Response.json({ status: "error", error: "TEST_SECRET" });
    return new Response("TEST_SECRET", { status: 200 });
  } });
  const error = await mps.submitResult("blockchain-id", "a".repeat(64)).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(Error);
  expect(error).not.toBeInstanceOf(SafeToRetryError);
  expect((error as Error).message).not.toContain("TEST_SECRET");
  expect((error as Error).stack).not.toContain("TEST_SECRET");
  expect((error as Error).cause).toBeUndefined();
  expect(formatWorkerFailure(error)).not.toContain("TEST_SECRET");
  expect(formatWorkerFailure(error)).toContain("worker_failed WorkerError: MPS");
});
