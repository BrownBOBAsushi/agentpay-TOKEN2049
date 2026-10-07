import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Address, KeyHash, PrivateKey } from "@evolution-sdk/evolution";
import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { guardCheck, proposalDigest, signReceipt, type MandateBundle, type SpendProposal } from "../guard";
import { createDevMandate } from "../orchestrator/mandate";
import { createStoreHireService } from "./store-hire.server";
import { createLatteHandler } from "./store-seller.server";
import { STORE_PAYEE } from "./store-live.server";
import { hireStoreFromBrowser } from "./store-hire-browser";
import { consumeStoreLiveKey, createStoreLiveAccess } from "./store-browser";
import { StoreLiveControls, StoreVerdict } from "./StoreClient";
import { STORE_INJECTION } from "./store-contract";
import { StoreHireSchema } from "./store-hire-contract";
import { issueStoreTaskToken, storeTaskTokenKey } from "./store-task-token.server";
vi.mock("server-only", () => ({}));
vi.mock("@x402/next", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("@x402/next");
});
afterEach(() => { vi.restoreAllMocks(); });
// Synthetic credentials and Guard seed only; all transport stays inside these fakes.
const liveKey = "TEST-LIVE-LINK-KEY-0000000000000000000000";
const guardSeed = "03".repeat(32);
const guardAddress = Address.toBech32(Address.fromHex(`60${KeyHash.toHex(KeyHash.fromPrivateKey(PrivateKey.fromHex(guardSeed)))}`));
const env = { STORE_LIVE_KEY: liveKey, SOKOSUMI_API_URL: "https://api.preprod.sokosumi.com",
  SOKOSUMI_COWORKER_API_KEY: "TEST-CORE-CREDENTIAL", SOKOSUMI_COWORKER_ID: "test-guard",
  SOKOSUMI_TASK_USER_ID: "test-user", GUARD_ADDRESS: guardAddress };
const origin = "https://store.test", txHash = "ab".repeat(32), taskId = "live-store-task";
function setup(settings: { payFailure?: boolean; offer?: "bad" | "unavailable"; changedInputs?: boolean; wrongStatusDigest?: boolean } = {}) {
  const time = Date.now(); vi.spyOn(Date, "now").mockReturnValue(time);
  const fixture = createDevMandate({ payee: STORE_PAYEE, amount: "6500000" });
  let inputs: { mandateBundle: MandateBundle; proposal: SpendProposal };
  const facilitator = { getSupported: vi.fn(async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "cardano:preprod" as const }], extensions: [], signers: {} })),
    verify: vi.fn(async () => ({ isValid: true })), settle: vi.fn(async () => ({ success: true, network: "cardano:preprod" as const, transaction: txHash })) };
  const seller = createLatteHandler(facilitator);
  const upstream = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    expect(new Headers(init?.headers).has("x-store-live-key")).toBe(false);
    expect(String(init?.body)).not.toContain(liveKey);
    if (url.origin === origin) {
      expect(url.href).toBe(`${origin}/api/store/latte`); expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
      if (settings.offer === "unavailable") throw new Error(liveKey + " private provider detail");
      const response = await seller(new NextRequest(url));
      if (settings.offer === "bad") return new Response(null, { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ x402Version: 2,
        accepts: [{ scheme: "exact", network: "cardano:preview", payTo: STORE_PAYEE, amount: "6500000", asset: "lovelace", maxTimeoutSeconds: 600 }] })).toString("base64") } });
      return response;
    }
    expect(url.origin).toBe("https://api.preprod.sokosumi.com");
    if (init?.method === "POST") {
      inputs = JSON.parse(JSON.parse(String(init.body)).description);
      return Response.json({ data: { id: taskId } });
    }
    if (url.pathname.endsWith("/events")) {
      const result = guardCheck({ bundle: inputs.mandateBundle, proposal: inputs.proposal }, { nowSec: Math.floor(time / 1000), nonceUsed: false });
      const signed = signReceipt({ ...result, v: 1, taskId, ts: Math.floor(time / 1000), mandateDigest: inputs.mandateBundle.digest,
        proposalDigest: proposalDigest(inputs.proposal) }, { privateKeyHex: guardSeed, address: guardAddress });
      return Response.json({ data: [{ status: "COMPLETED", comment: JSON.stringify(signed) }] });
    }
    if (url.pathname.endsWith("/receipt")) return Response.json({ data: null });
    return Response.json({ data: { id: taskId, status: "COMPLETED", description: JSON.stringify(settings.changedInputs
      ? { ...inputs, proposal: { ...inputs.proposal, requirements: { ...inputs.proposal.requirements, amount: "28000000" } } } : inputs) } });
  });
  const service = createStoreHireService({ bundle: fixture, env: () => env, fetch: upstream, now: () => time });
  const pay = vi.fn<typeof fetch>(async (_input, init) => {
    expect(new Headers(init?.headers).get("x-store-live-key")).toBe(liveKey);
    expect(JSON.parse(String(init?.body))).toEqual({ taskId });
    if (settings.payFailure) throw new Error(liveKey + " private provider detail");
    return Response.json({ status: "confirmed", txHash });
  });
  const browser = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), origin), request = new Request(url, init);
    if (url.pathname === "/api/store/hire") return service.hire(request);
    if (url.pathname === "/api/store/pay") return pay(input, init);
    const response = await service.status(taskId, request.headers.get("x-store-task-token"), request.headers.get("x-store-proposal-digest"), request);
    if (settings.wrongStatusDigest && response.ok) return Response.json({ ...await response.json(), mandateDigest: "cd".repeat(32) });
    return response;
  });
  let clock = 0;
  return { fixture, upstream, browser, pay, facilitator, service, inputs: () => inputs, run: (injection: string | null, key: string | undefined = liveKey, upload?: unknown) =>
    hireStoreFromBrowser(injection, { liveKey: key, mandateBundle: upload, fetch: browser, now: () => clock, wait: async (ms) => { clock += ms; } }) };
}
function hireRequest(injection: string | null, mandateBundle?: unknown) {
  return new Request(`${origin}/api/store/hire`, { method: "POST", headers: { "x-store-live-key": liveKey },
    body: JSON.stringify({ injection, ...(mandateBundle !== undefined ? { mandateBundle } : {}) }) });
}
it("live Buy with injection OFF fetches a real x402 402, hires APPROVE, pays once and renders the transaction", async () => {
  const log = vi.spyOn(console, "log"), error = vi.spyOn(console, "error");
  const test = setup(), result = await test.run(null);
  expect(result).toMatchObject({ live: true, verdict: "APPROVE", receiptValid: true, txHash, taskId });
  expect(test.pay).toHaveBeenCalledTimes(1); expect(test.facilitator.verify).not.toHaveBeenCalled(); expect(test.facilitator.settle).not.toHaveBeenCalled();
  expect(test.inputs().proposal.requirements.extra).toEqual({ confirmationPolicy: { l1Confirmations: 0 } });
  expect(test.upstream.mock.calls.map(([url]) => new URL(String(url)).pathname).slice(0, 2)).toEqual(["/api/store/latte", "/v1/tasks"]);
  for (const [, init] of test.browser.mock.calls) expect(new Headers(init?.headers).get("x-store-live-key")).toBe(liveKey);
  const html = renderToStaticMarkup(h(StoreVerdict, { bundle: result.bundle!, result, testKey: false }));
  for (const line of ["402 PAYMENT-REQUIRED: 6.5 tADA to The Corner Store", `Guard hired on Sokosumi — Task ${taskId}`,
    "Signed Guard Receipt verified: APPROVE", "Paying over x402 on Cardano preprod…", `Paid: ${txHash}`, "CLEARED", "Paid on Cardano preprod"]) expect(html).toContain(line);
  expect(html).toContain(`href="https://preprod.cardanoscan.io/transaction/${txHash}"`);
  expect(html).toContain(`href="/receipt/${taskId}"`); expect(html).not.toContain("No money moves here.");
  expect(html).not.toContain(liveKey); expect(JSON.stringify(result)).not.toContain(liveKey);
  expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
});
it.each([undefined, "wrong-key"])("missing/wrong live key %s retains public local APPROVE and never hires or pays", async (key) => {
  const test = setup();
  const result = await hireStoreFromBrowser(null, { liveKey: key, mandateBundle: { invalid: true }, fetch: test.browser });
  expect(result).toMatchObject({ verdict: "APPROVE", note: expect.stringContaining("one-time Mandate") });
  expect(result.live).toBeUndefined(); expect(test.upstream).not.toHaveBeenCalled(); expect(test.pay).not.toHaveBeenCalled();
});
it("uploaded signed Mandate binds the Task and token and succeeds across service instances", async () => {
  const test = setup(), uploaded = createDevMandate({ payee: STORE_PAYEE, amount: "6500000" });
  expect(uploaded.digest).not.toBe(test.fixture.digest);
  const authorization = StoreHireSchema.parse(await (await test.service.hire(hireRequest(null, uploaded))).json());
  if (authorization.mode !== "hired") throw new Error("Expected a live hire");
  expect(test.inputs().mandateBundle).toEqual(uploaded);
  const payload = JSON.parse(Buffer.from(authorization.taskToken.split(".")[0], "base64url").toString());
  expect(payload.mandateDigest).toBe(uploaded.digest);
  const other = createStoreHireService({ bundle: test.fixture, env: () => env, fetch: test.upstream });
  const response = await other.status(taskId, authorization.taskToken, proposalDigest(authorization.proposal), hireRequest(null));
  expect(await response.json()).toMatchObject({ status: "completed", verdict: "APPROVE", mandateDigest: uploaded.digest });
  const count = test.upstream.mock.calls.length;
  expect((await other.status(taskId, authorization.taskToken, proposalDigest(authorization.proposal))).status).toBe(403);
  expect(test.upstream).toHaveBeenCalledTimes(count);
});
it("uses the uploaded bundle in the browser outcome and pays that hired Task only", async () => {
  const test = setup(), uploaded = createDevMandate({ payee: STORE_PAYEE, amount: "6500000" });
  const result = await test.run(null, liveKey, uploaded);
  expect(result.bundle).toEqual(uploaded); expect(test.inputs().mandateBundle).toEqual(uploaded); expect(test.pay).toHaveBeenCalledTimes(1);
});
it.each(["shape", "signature", "amount", "expiry"])("invalid uploaded Mandate (%s) returns 400 before any fetch or hire", async (kind) => {
  const test = setup();
  const input = kind === "shape" ? {} : kind === "signature" ? { ...test.fixture, coseSign1: "00" }
    : kind === "amount" ? createDevMandate({ payee: STORE_PAYEE, amount: "28000000" }) : test.fixture;
  if (kind === "expiry") vi.spyOn(Date, "now").mockReturnValue((test.fixture.mandate.expiry + 1) * 1000);
  const service = kind === "expiry" ? createStoreHireService({ bundle: test.fixture, env: () => env, fetch: test.upstream }) : test.service;
  const response = await service.hire(hireRequest(null, input));
  expect(response.status).toBe(400); expect(await response.text()).toContain("valid, unexpired signed Mandate");
  expect(test.upstream).not.toHaveBeenCalled();
});
it("injection ON hires a signed REFUSE without fetching the honest offer or paying", async () => {
  const test = setup(), result = await test.run(STORE_INJECTION);
  expect(result).toMatchObject({ live: true, receiptValid: true, verdict: "REFUSE" });
  expect(test.pay).not.toHaveBeenCalled(); expect(test.upstream.mock.calls.some(([url]) => String(url).includes("/latte"))).toBe(false);
});
it.each(["bad", "unavailable"] as const)("failed/unsafe offer %s stops before Task creation and suppresses provider details", async (offer) => {
  const test = setup({ offer }), response = await test.service.hire(hireRequest(null));
  expect(response.status).toBe(503); expect(await response.text()).not.toContain(liveKey); expect(test.upstream).toHaveBeenCalledTimes(1);
});
it.each(["changedInputs", "wrongStatusDigest"] as const)("does not pay when %s breaks the receipt binding", async (flag) => {
  const test = setup({ [flag]: true }), result = await test.run(null);
  expect(result.receiptValid).toBe(false); expect(test.pay).not.toHaveBeenCalled();
});
it("ambiguous payment failure returns an honest message without retry, raw details or a paid claim", async () => {
  const test = setup({ payFailure: true }), result = await test.run(null);
  expect(test.pay).toHaveBeenCalledTimes(1); expect(result.txHash).toBeUndefined(); expect(result.note).toContain("no automatic payment retry");
  const html = renderToStaticMarkup(h(StoreVerdict, { bundle: test.fixture, result, testKey: false }));
  expect(html).toContain("Payment not confirmed here"); expect(html).not.toContain("Paid on Cardano preprod");
  expect(html).not.toContain(liveKey); expect(html).not.toContain("private provider detail");
});
it.each(["tampered", "expired", "wrong-task", "wrong-proposal"])("live status rejects %s token before any Core read", async (kind) => {
  const test = setup(), digest = "ab".repeat(32), now = Math.floor(Date.now() / 1000);
  let token = issueStoreTaskToken({ taskId, mandateDigest: test.fixture.digest, proposalDigest: digest }, storeTaskTokenKey(env.SOKOSUMI_COWORKER_API_KEY), now);
  if (kind === "tampered") token = token.slice(0, -2) + "AA";
  if (kind === "expired") token = issueStoreTaskToken({ taskId, mandateDigest: test.fixture.digest, proposalDigest: digest }, storeTaskTokenKey(env.SOKOSUMI_COWORKER_API_KEY), now - 900);
  const response = await test.service.status(kind === "wrong-task" ? "other-task" : taskId, token,
    kind === "wrong-proposal" ? "cd".repeat(32) : digest, hireRequest(null));
  expect(response.status).toBe(403); expect(test.upstream).not.toHaveBeenCalled();
});
it("live controls never accept a key prop and the URL reader removes the private parameter before navigation", () => {
  const replace = vi.fn();
  expect(consumeStoreLiveKey(`${origin}/store?live=${liveKey}&keep=yes#latte`, replace)).toBe(liveKey);
  expect(replace).toHaveBeenCalledWith("/store?keep=yes#latte");
  const html = renderToStaticMarkup(h(StoreLiveControls, { disabled: false, loaded: false, onLoad: () => {} }));
  expect(html).toContain("LIVE"); expect(html).toContain("Load signed Mandate (bundle.json)"); expect(html).not.toContain(liveKey);
  expect(html).toContain('type="file"'); expect(html).toContain('for="store-mandate-file"');
});
it("reads the private URL once across subscriptions and keeps the server snapshot public", () => {
  const getHref = vi.fn(() => `${origin}/store?live=${liveKey}`), replace = vi.fn(), listener = vi.fn();
  const access = createStoreLiveAccess(getHref, replace);
  expect(access.getServerSnapshot()).toBeUndefined(); expect(access.getSnapshot()).toBeUndefined();
  access.subscribe(listener)(); access.subscribe(listener)();
  expect(access.getSnapshot()).toBe(liveKey); expect(access.getServerSnapshot()).toBeUndefined();
  expect(getHref).toHaveBeenCalledTimes(1); expect(replace).toHaveBeenCalledTimes(1); expect(listener).toHaveBeenCalledTimes(1);
});
it("ambiguous live hire failure never retries creation, falls back to the public fixture or starts payment", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => { throw new Error(liveKey + " provider details"); });
  await expect(hireStoreFromBrowser(null, { liveKey, fetch: fetcher })).rejects.toThrow("Live hire stopped");
  expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe("/api/store/hire");
});
