import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { hireStoreFromBrowser } from "./store-hire-browser";
import { StoreAgentLog, StoreVerdict } from "./StoreClient";
import { runStoreCheck } from "./store-check";
import { presentStoreResult } from "./store-browser";
import { STORE_INJECTION } from "./store-contract";
import { MandateBundleSchema } from "../guard/bundle";
import fixture from "./fixtures/store-mandate.json";
const bundle = MandateBundleSchema.parse(fixture);
const local = runStoreCheck(STORE_INJECTION, bundle, bundle.mandate.expiry - 3600);
const taskId = "browser-store-task";
const hired = { mode: "hired", taskId, local, proposal: local.proposal,
  steps: [...local.steps, `Guard hired on Sokosumi — Task ${taskId}`] };
function clock() {
  let time = 0; const wait = vi.fn(async (ms: number) => { time += ms; });
  return { now: () => time, wait };
}
it("polls every 2 seconds, shows the three log lines, then the signed verdict and proof links", async () => {
  const timer = clock(), progress = vi.fn(); const presentation = await presentStoreResult(local);
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (url === "/api/store/hire") {
      expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json",
        "X-Store-Request-Id": expect.stringMatching(/^[0-9a-f-]{36}$/) }, body: JSON.stringify({ injection: STORE_INJECTION }) });
      return Response.json(hired);
    }
    expect(url).toBe(`/api/store/hire/${taskId}`); expect(init).toMatchObject({ method: "GET", cache: "no-store" });
    return timer.now() === 2000 ? Response.json({ status: "pending" }) : Response.json({ status: "completed",
      receiptValid: true, verdict: "REFUSE", reasons: ["AMOUNT_MISMATCH"], diff: local.diff,
      mandateDigest: bundle.digest, proposalDigest: presentation.proposalDigest });
  });
  const result = await hireStoreFromBrowser(STORE_INJECTION, { fetch: fetcher, ...timer, onSteps: progress });
  expect(timer.wait.mock.calls).toEqual([[2000], [2000]]); expect(fetcher).toHaveBeenCalledTimes(3);
  expect(result.reasons).toEqual(["AMOUNT_MISMATCH"]); // Uses the returned signed verdict, not the local prediction.
  expect(result).toMatchObject({ taskId, receiptValid: true });
  const inProgress = renderToStaticMarkup(h(StoreAgentLog, { steps: progress.mock.calls[0][0], live: true }));
  expect(inProgress).toContain('aria-live="polite"'); expect(inProgress).toContain("Guard is checking…");
  const html = renderToStaticMarkup(h(StoreVerdict, { bundle, result, testKey: false }));
  for (const step of [`Guard hired on Sokosumi — Task ${taskId}`, "Guard is checking…", "Signed Guard Receipt verified"]) expect(html).toContain(step);
  expect(html).toContain("RETURNED"); expect(html).toContain("Open the Task on Sokosumi");
  expect(html).toContain(`href="https://preprod.sokosumi.com/tasks/${taskId}"`);
  expect(html).toContain("your Sokosumi workspace (sign-in)"); expect(html).toContain("Signed Receipt (public)");
  expect(html).toContain(`href="/receipt/${taskId}"`); expect(html).toContain("No money moves here.");
});
it("returns local APPROVE with the one-time Mandate note and never polls", async () => {
  const approved = runStoreCheck(null, bundle, bundle.mandate.expiry - 3600);
  const note = "APPROVE is not hired on the public page — one-time Mandate; see the recorded paid run";
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ...approved, mode: "local", note, steps: [...approved.steps, note] }));
  const result = await hireStoreFromBrowser(null, { fetch: fetcher });
  expect(result).toMatchObject({ verdict: "APPROVE", note }); expect(result.taskId).toBeUndefined(); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("stops polling at 60 seconds and honestly presents the local verdict", async () => {
  const timer = clock();
  const fetcher = vi.fn<typeof fetch>(async (url) => Response.json(url === "/api/store/hire" ? hired : { status: "pending" }));
  const result = await hireStoreFromBrowser(STORE_INJECTION, { fetch: fetcher, ...timer });
  expect(timer.now()).toBe(60_000); expect(result).toMatchObject({ verdict: "REFUSE", receiptValid: false,
    note: "Guard did not answer in 60 s — showing the local check" });
  expect(timer.wait.mock.calls.every(([ms]) => ms === 2000)).toBe(true);
  expect(fetcher.mock.calls.filter(([url]) => url === "/api/store/hire")).toHaveLength(1);
  const html = renderToStaticMarkup(h(StoreVerdict, { bundle, result, testKey: false }));
  expect(html).toContain(result.note!); expect(html).not.toContain("Signed Guard Receipt verified");
  expect(html).toContain("Receipt page (public)");
});
it("retries only transient reads until the deadline, never task creation", async () => {
  const timer = clock();
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (url === "/api/store/hire") return Response.json(hired);
    if (timer.now() === 2000) throw new Error("private-provider-details");
    return new Response("private-provider-details", { status: 503 });
  });
  const result = await hireStoreFromBrowser(STORE_INJECTION, { fetch: fetcher, ...timer });
  expect(timer.now()).toBe(60_000); expect(JSON.stringify(result)).not.toContain("private-provider-details");
  expect(fetcher.mock.calls.filter(([url]) => url === "/api/store/hire")).toHaveLength(1);
});
it("bounds a slow final read and never polls after the deadline", async () => {
  const timer = clock(); const presentation = await presentStoreResult(local);
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (url === "/api/store/hire") return Response.json(hired);
    expect(init?.signal).toBeInstanceOf(AbortSignal); await timer.wait(59_000);
    return Response.json({ status: "completed", receiptValid: true, verdict: "APPROVE", reasons: [], diff: [],
      mandateDigest: bundle.digest, proposalDigest: presentation.proposalDigest });
  });
  const result = await hireStoreFromBrowser(STORE_INJECTION, { fetch: fetcher, ...timer });
  expect(result).toMatchObject({ receiptValid: false, verdict: "REFUSE" }); expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each(["failed", "unknown", "wrong-digest", "unverified"])("falls back honestly for %s", async (state) => {
  const timer = clock(); const presentation = await presentStoreResult(local);
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (url === "/api/store/hire") return Response.json(hired);
    if (state === "unknown") return new Response("private-provider-details", { status: 404 });
    if (state === "failed") return Response.json({ status: "failed", receiptValid: false, note: "Guard Task failed — showing the local check" });
    return Response.json({ status: "completed", receiptValid: state !== "unverified", verdict: "APPROVE", reasons: [], diff: [],
      mandateDigest: bundle.digest, proposalDigest: state === "wrong-digest" ? "a".repeat(64) : presentation.proposalDigest });
  });
  const result = await hireStoreFromBrowser(STORE_INJECTION, { fetch: fetcher, ...timer });
  expect(result).toMatchObject({ verdict: "REFUSE", receiptValid: false }); expect(result.note).toBeTruthy();
  expect(result.steps).not.toContain("Signed Guard Receipt verified"); expect(JSON.stringify(result)).not.toContain("private-provider-details");
});
it("uses only the local check after an ambiguous create failure, without a second hire", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (url === "/api/store/hire") throw new Error("private-provider-details");
    expect(url).toBe("/api/store/check"); return Response.json(local);
  });
  const result = await hireStoreFromBrowser(STORE_INJECTION, { fetch: fetcher });
  expect(result).toMatchObject({ verdict: "REFUSE", note: "Guard could not be hired — showing the local check" });
  expect(fetcher).toHaveBeenCalledTimes(2); expect(result.taskId).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("private-provider-details");
});
it("keeps server configuration and receipt loading out of the browser entry points", () => {
  for (const file of ["StoreClient.tsx", "store-browser.ts", "store-hire-browser.ts", "store-contract.ts", "store-hire-contract.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).not.toMatch(/process\.env|SOKOSUMI_COWORKER_API_KEY|SOKOSUMI_TASK_USER_ID|\.server["']|worker\/core/);
  }
  expect(readFileSync(new URL("store-hire.server.ts", import.meta.url), "utf8")).toContain('import "server-only"');
});
