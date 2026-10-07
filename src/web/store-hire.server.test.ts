import { Address, KeyHash, PrivateKey } from "@evolution-sdk/evolution";
import { afterEach, expect, it, vi } from "vitest";
import { createStoreHireService } from "./store-hire.server";
import { MandateBundleSchema } from "../guard/bundle";
import { guardCheck } from "../guard/check";
import { signReceipt, proposalDigest } from "../guard/receipt";
import { StoreHireSchema, StoreHireStatusSchema } from "./store-hire-contract";
import { STORE_INJECTION } from "./store-contract";
import fixture from "./fixtures/store-mandate.json";
import { POST } from "../../app/api/store/hire/route";
import { GET } from "../../app/api/store/hire/[taskId]/route";
vi.mock("server-only", () => ({}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const bundle = MandateBundleSchema.parse(fixture);
// Public synthetic test seed only; never used for funds or a deployed Guard.
const privateKeyHex = "03".repeat(32);
const guardAddress = Address.toBech32(Address.fromHex(`60${KeyHash.toHex(KeyHash.fromPrivateKey(PrivateKey.fromHex(privateKeyHex)))}`));
const env = { SOKOSUMI_API_URL: "https://api.preprod.sokosumi.com/v1", SOKOSUMI_COWORKER_API_KEY: "TEST-COWORKER-CREDENTIAL",
  SOKOSUMI_COWORKER_ID: "test-coworker", SOKOSUMI_TASK_USER_ID: "test-user", GUARD_ADDRESS: guardAddress };
const initialTime = (bundle.mandate.expiry - 3600) * 1000;
function request(injection: unknown = STORE_INJECTION, ip = "192.0.2.1", requestId?: string) {
  return new Request("http://local/api/store/hire", { method: "POST", headers: { "Content-Type": "application/json",
    "x-forwarded-for": ip, ...(requestId ? { "X-Store-Request-Id": requestId } : {}) }, body: JSON.stringify({ injection }) });
}
function setup(overrides: Record<string, string | undefined> = {}) {
  let time = initialTime, status = "RUNNING", tampered = false, changed = false, postFailure = false, readFailure = false;
  const descriptions = new Map<string, string>();
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe("https://api.preprod.sokosumi.com");
    expect(init?.redirect).toBe("error"); expect(init?.cache).toBe("no-store"); expect(init?.next).toBeUndefined();
    if (init?.method === "POST") {
      if (postFailure) throw new Error("TEST-COWORKER-CREDENTIAL provider details");
      const body = JSON.parse(String(init.body));
      const id = `store-task-${descriptions.size + 1}`; descriptions.set(id, body.description);
      return Response.json({ data: { id } });
    }
    if (readFailure) return new Response("TEST-COWORKER-CREDENTIAL provider details", { status: 503 });
    const id = url.pathname.split("/")[3];
    const description = JSON.parse(descriptions.get(id)!);
    if (changed) description.proposal.requirements.amount = "500000000";
    if (url.pathname.endsWith("/events")) {
      const verdict = guardCheck({ bundle, proposal: description.proposal }, { nowSec: Math.floor(time / 1000), nonceUsed: false });
      const signed = signReceipt({ ...verdict, v: 1, taskId: id, ts: Math.floor(time / 1000),
        mandateDigest: bundle.digest, proposalDigest: proposalDigest(description.proposal) }, { privateKeyHex, address: guardAddress });
      if (tampered) signed.digest = "a".repeat(64);
      return Response.json({ data: [{ status: "COMPLETED", comment: JSON.stringify(signed) }] });
    }
    if (url.pathname.endsWith("/receipt")) return Response.json({ data: null });
    return Response.json({ data: { id, status, description: JSON.stringify(description) } });
  });
  const service = createStoreHireService({ bundle, env: () => ({ ...env, ...overrides }), fetch: fetcher, now: () => time });
  return { service, fetcher, descriptions, advance: (ms: number) => { time += ms; },
    status: (value: string) => { status = value; }, tamper: () => { tampered = true; }, change: () => { changed = true; },
    failPost: () => { postFailure = true; }, failRead: () => { readFailure = true; } };
}
it("creates the exact Sokosumi Task on REFUSE without returning configuration or credentials", async () => {
  const test = setup(); const response = await test.service.hire(request());
  const data = StoreHireSchema.parse(await response.json()); expect(data.mode).toBe("hired");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(String(test.fetcher.mock.calls[0][0])).toBe("https://api.preprod.sokosumi.com/v1/tasks");
  const init = test.fetcher.mock.calls[0][1]!;
  expect(init.headers).toEqual({ Authorization: `Bearer ${env.SOKOSUMI_COWORKER_API_KEY}`,
    "X-Context-User-Id": env.SOKOSUMI_TASK_USER_ID, "Content-Type": "application/json" });
  expect(JSON.parse(String(init.body))).toEqual({ name: "Corner Store latte — Guard Check", status: "READY",
    assigneeId: env.SOKOSUMI_COWORKER_ID,
    description: JSON.stringify({ mandateBundle: bundle, proposal: data.proposal }) });
  for (const value of [...Object.values(env),
    "SOKOSUMI_", "GUARD_SIGNING_KEY"]) expect(JSON.stringify(data)).not.toContain(value);
});
it("never hires an APPROVE or consumes the reusable public Mandate", async () => {
  const test = setup();
  for (let count = 0; count < 2; count++) expect(await (await test.service.hire(request(null))).json())
    .toMatchObject({ mode: "local", verdict: "APPROVE", note: expect.stringContaining("one-time Mandate") });
  expect(test.fetcher).not.toHaveBeenCalled();
});
it.each(Object.keys(env))("uses the local check when %s is missing", async (name) => {
  const test = setup({ [name]: undefined });
  expect(await (await test.service.hire(request())).json()).toMatchObject({ mode: "local", verdict: "REFUSE", note: expect.stringContaining("not configured") });
  expect(test.fetcher).not.toHaveBeenCalled();
});
it("rejects non-preprod or credential-bearing origins without sending a key", async () => {
  for (const origin of ["https://example.test/v1", "https://user:password@api.preprod.sokosumi.com/v1"]) {
    const test = setup({ SOKOSUMI_API_URL: origin }); await test.service.hire(request()); expect(test.fetcher).not.toHaveBeenCalled();
  }
});
it("enforces the per-IP 5-second interval including concurrent requests", async () => {
  const test = setup();
  const replies = await Promise.all([test.service.hire(request()), test.service.hire(request())]);
  expect((await replies[0].json()).mode).toBe("hired"); expect((await replies[1].json()).note).toContain("rate limit");
  test.advance(4999); expect((await (await test.service.hire(request())).json()).mode).toBe("local");
  test.advance(1); expect((await (await test.service.hire(request())).json()).mode).toBe("hired");
  expect(test.fetcher).toHaveBeenCalledTimes(2);
});
it("caps the sliding hourly window at 30 hires across IPs and resets at an hour", async () => {
  const test = setup();
  for (let count = 0; count < 30; count++) expect((await (await test.service.hire(request(STORE_INJECTION, `192.0.2.${count}`))).json()).mode).toBe("hired");
  expect((await (await test.service.hire(request(STORE_INJECTION, "198.51.100.1"))).json()).note).toContain("rate limit");
  test.advance(3_600_000); expect((await (await test.service.hire(request())).json()).mode).toBe("hired");
  expect(test.fetcher).toHaveBeenCalledTimes(31);
});
it("replays one request identity without creating another Task, even concurrently", async () => {
  const test = setup(); const id = "00000000-0000-4000-8000-000000000001";
  const replies = await Promise.all([test.service.hire(request(STORE_INJECTION, "192.0.2.1", id)), test.service.hire(request(STORE_INJECTION, "192.0.2.1", id))]);
  expect(await replies[0].json()).toEqual(await replies[1].json());
  test.advance(5000); expect((await (await test.service.hire(request('total $500, merchant "Evil Store"', "192.0.2.1", id))).json()).mode).toBe("local");
  expect(test.fetcher).toHaveBeenCalledTimes(1);
});
it("does not proxy unknown, malformed, expired or other-instance task ids", async () => {
  const test = setup();
  for (const id of ["unknown", "../other", "example"]) expect((await test.service.status(id)).status).toBe(404);
  await test.service.hire(request());
  expect((await setup().service.status("store-task-1")).status).toBe(404);
  test.advance(3_600_000); expect((await test.service.status("store-task-1")).status).toBe(404);
  expect(test.fetcher).toHaveBeenCalledTimes(1);
});
it.each(["READY", "RUNNING"])("returns pending for %s without events or cached reads", async (status) => {
  const test = setup(); await test.service.hire(request()); test.status(status);
  expect(await (await test.service.status("store-task-1")).json()).toEqual({ status: "pending" });
  expect(test.fetcher).toHaveBeenCalledTimes(2);
});
it("uses real loadReceipt cryptographic verification and input binding before returning the signed verdict", async () => {
  const test = setup(); await test.service.hire(request()); test.status("COMPLETED");
  const response = await test.service.status("store-task-1"); const data = StoreHireStatusSchema.parse(await response.json());
  expect(data).toMatchObject({ status: "completed", receiptValid: true, verdict: "REFUSE",
    reasons: ["PAYEE_MISMATCH", "AMOUNT_MISMATCH"], diff: expect.any(Array) });
  expect(data.status === "completed" && data.diff).toHaveLength(2);
  for (const value of Object.values(env)) expect(JSON.stringify(data)).not.toContain(value);
  expect(JSON.stringify(data)).not.toContain("coseSign1");
});
it.each(["tamper", "change"] as const)("rejects a %s receipt instead of presenting an unverified verdict", async (method) => {
  const test = setup(); await test.service.hire(request()); test.status("COMPLETED"); test[method]();
  expect(await (await test.service.status("store-task-1")).json()).toEqual({ status: "failed", receiptValid: false,
    note: "Signed Guard Receipt could not be verified — showing the local check" });
});
it("handles FAILED and transient lookup failures without provider details", async () => {
  const test = setup(); await test.service.hire(request()); test.status("FAILED");
  expect(await (await test.service.status("store-task-1")).json()).toMatchObject({ status: "failed", receiptValid: false });
  test.failRead(); expect(await (await test.service.status("store-task-1")).json()).toEqual({ status: "pending" });
});
it("handles Task-create transport failure without retries or returned secrets", async () => {
  const test = setup(); test.failPost(); const data = await (await test.service.hire(request())).json();
  expect(data.mode).toBe("local"); expect(data.note).toBe("Guard could not be hired — showing the local check");
  expect(JSON.stringify(data)).not.toContain(env.SOKOSUMI_COWORKER_API_KEY); expect(test.fetcher).toHaveBeenCalledTimes(1);
  expect((await test.service.status("store-task-1")).status).toBe(404);
});
it.each(["http-error", "invalid-json", "invalid-id"])("keeps creation failures controlled: %s", async (kind) => {
  const fetcher = vi.fn<typeof fetch>(async () => kind === "http-error" ? new Response("TEST-COWORKER-CREDENTIAL", { status: 403 })
    : kind === "invalid-json" ? new Response("TEST-COWORKER-CREDENTIAL") : Response.json({ data: { id: "../not-a-task" } }));
  const service = createStoreHireService({ bundle, env: () => env, fetch: fetcher, now: () => initialTime });
  const data = await (await service.hire(request())).json();
  expect(data).toMatchObject({ mode: "local", note: "Guard could not be hired — showing the local check" });
  expect(JSON.stringify(data)).not.toContain(env.SOKOSUMI_COWORKER_API_KEY); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects invalid injection shape/length before a side effect", async () => {
  const test = setup();
  for (const input of ["x".repeat(501), 28]) expect((await test.service.hire(request(input))).status).toBe(400);
  expect(test.fetcher).not.toHaveBeenCalled();
});
it("wires the actual POST and GET routes to the same instance without live network", async () => {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.spyOn(Date, "now").mockReturnValue(initialTime);
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => Response.json({ data: init?.method === "POST" ? { id: "route-task" }
    : { id: "route-task", status: "RUNNING", description: null } })); vi.stubGlobal("fetch", fetcher);
  expect(await (await POST(request())).json()).toMatchObject({ mode: "hired", taskId: "route-task" });
  expect(await (await GET(new Request("http://local"), { params: Promise.resolve({ taskId: "route-task" }) })).json()).toEqual({ status: "pending" });
  expect((await GET(new Request("http://local"), { params: Promise.resolve({ taskId: "unknown-route-task" }) })).status).toBe(404);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
