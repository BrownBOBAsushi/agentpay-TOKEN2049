import "server-only";
import { z } from "zod";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { guardCheck, SpendProposalSchema, jcs } from "../guard";
import type { MandateBundle } from "../guard/bundle";
import { MandateSchema } from "../guard/mandate";
import { mandateDigest } from "../guard/digest";
import { proposalDigest } from "../guard/receipt";
import { preprodOrigin } from "../worker/config";
import { loadReceipt } from "./receipt-data.server";
import { StoreRequestSchema, StoreResultSchema } from "./store-contract";
import { StoreTaskIdSchema } from "./store-hire-contract";
import { runStoreCheck } from "./store-check";
import { issueStoreTaskToken, storeTaskTokenKey, readStoreTaskToken } from "./store-task-token.server";
import { hasStoreLiveKey, validateStoreMandate, STORE_PAYEE, STORE_AMOUNT } from "./store-live.server";

const configSchema = z.object({ SOKOSUMI_API_URL: z.string().min(1), SOKOSUMI_COWORKER_API_KEY: z.string().min(1),
  SOKOSUMI_COWORKER_ID: z.string().min(1), SOKOSUMI_TASK_USER_ID: z.string().min(1), GUARD_ADDRESS: MandateSchema.shape.payer,
  STORE_TASK_TOKEN_SECRET: z.preprocess((value) => value === "" ? undefined : value, z.string().min(32).optional()) });
const createdSchema = z.object({ data: z.object({ id: StoreTaskIdSchema }) });
const hour = 3_600_000;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failed = (note: string) => json({ status: "failed", receiptValid: false, note });

export function createStoreHireService(options: { bundle: MandateBundle; env: () => Record<string, string | undefined>;
  fetch: typeof fetch; now?: () => number }) {
  const now = options.now ?? (() => Date.now());
  const attempts: { at: number; ip: string }[] = [];
  const requests = new Map<string, { at: number; fingerprint: string; result: Promise<unknown> }>();
  function config() {
    const parsed = configSchema.safeParse(options.env());
    if (!parsed.success) return null;
    try { return { ...parsed.data, origin: preprodOrigin(parsed.data.SOKOSUMI_API_URL),
      tokenKey: storeTaskTokenKey(parsed.data.SOKOSUMI_COWORKER_API_KEY, parsed.data.STORE_TASK_TOKEN_SECRET) }; } catch { return null; }
  }
  return {
    async hire(request: Request): Promise<Response> {
      let body: unknown;
      try { body = await request.json(); } catch { body = null; }
      const live = hasStoreLiveKey(request, options.env());
      const parsed = (live ? StoreRequestSchema.extend({ mandateBundle: z.unknown().optional() }) : StoreRequestSchema)
        .safeParse(!live && body && typeof body === "object" && "mandateBundle" in body
          ? { injection: (body as { injection?: unknown }).injection } : body);
      if (!parsed.success) return json({ error: "Send injection as a string of at most 500 characters, or null." }, 400);
      let bundle = options.bundle;
      if (live) {
        try { bundle = validateStoreMandate("mandateBundle" in parsed.data && parsed.data.mandateBundle !== undefined
          ? parsed.data.mandateBundle : bundle, { nowSec: Math.floor(now() / 1000) }); }
        catch { return json({ error: "Load a valid, unexpired signed Mandate for 6.5 tADA to The Corner Store." }, 400); }
      }
      let prediction = runStoreCheck(parsed.data.injection, bundle, Math.floor(now() / 1000));
      // The honest offer comes from this deployment, not the scripted listing. Never forward the live key.
      if (live && prediction.proposal.requirements.payTo === STORE_PAYEE && prediction.proposal.requirements.amount === STORE_AMOUNT) {
        try {
          const endpoint = new URL("/api/store/latte", request.url);
          if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error();
          const response = await options.fetch(endpoint, { method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
          if (response.status !== 402) throw new Error();
          const required = new x402HTTPClient(new x402Client()).getPaymentRequiredResponse((name) => response.headers.get(name));
          if (required.x402Version !== 2) throw new Error();
          const proposal = SpendProposalSchema.parse({ kind: "x402", requirements: required.accepts[0] });
          const r = proposal.requirements;
          if (r.scheme !== "exact" || r.network !== "cardano:preprod" || r.asset !== "lovelace" || r.amount !== STORE_AMOUNT
            || r.payTo !== STORE_PAYEE || r.maxTimeoutSeconds <= 0 || r.maxTimeoutSeconds > 600) throw new Error();
          prediction = StoreResultSchema.parse({ ...prediction, proposal,
            ...guardCheck({ bundle, proposal }, { nowSec: Math.floor(now() / 1000), nonceUsed: false }),
            steps: [...prediction.steps.slice(0, -1), "402 PAYMENT-REQUIRED: 6.5 tADA to The Corner Store", `Instant pre-check (same Guard code): ${prediction.verdict}`] });
        } catch { return json({ error: "Store payment requirements unavailable. Nothing hired or paid." }, 503); }
      }
      const preCheck = `Instant pre-check (same Guard code): ${prediction.verdict}${prediction.verdict === "REFUSE"
        || live ? " — hiring the Guard on Sokosumi to sign it" : " — not hiring on the public page (one-time Mandate)"}`;
      const local = { ...prediction, steps: [...prediction.steps.slice(0, -1), preCheck] };
      const fallback = (reason: string) => {
        const note = live ? `${reason} — local check only — not hired, not paid` : reason;
        return { ...local, mode: "local", note, steps: [...local.steps, note], ...(live ? { live: true, bundle } : {}) };
      };
      if (!live && local.verdict === "APPROVE") return json(fallback("APPROVE is not hired on the public page — one-time Mandate; see the recorded paid run"));
      const cfg = config();
      if (!cfg) return json(fallback("Guard hiring is not configured — showing the local check"));
      const time = now();
      while (attempts[0] && attempts[0].at <= time - hour) attempts.shift();
      for (const [id, entry] of requests) if (entry.at <= time - hour) requests.delete(id);
      const ip = (request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown").slice(0, 128);
      const requestId = z.uuid().safeParse(request.headers.get("x-store-request-id"));
      const key = requestId.success ? `${ip}:${requestId.data}` : null;
      const fingerprint = jcs({ live, injection: parsed.data.injection, mandateDigest: bundle.digest, proposal: local.proposal });
      const previous = key ? requests.get(key) : undefined;
      if (previous) return json(previous.fingerprint === fingerprint ? await previous.result
        : fallback("Request identity reused with different text — showing the local check"));
      if (attempts.length >= 30 || attempts.some((entry) => entry.ip === ip && time - entry.at < 5000)) {
        return json(fallback("Guard hiring rate limit — showing the local check"));
      }
      // Reserve before awaiting: concurrent requests cannot bypass the limits or duplicate an attempt.
      attempts.push({ at: time, ip });
      const result = (async () => {
        try {
          const response = await options.fetch(new URL("/v1/tasks", cfg.origin), { method: "POST", redirect: "error",
            cache: "no-store", signal: AbortSignal.timeout(10_000),
            headers: { Authorization: `Bearer ${cfg.SOKOSUMI_COWORKER_API_KEY}`, "X-Context-User-Id": cfg.SOKOSUMI_TASK_USER_ID,
              "Content-Type": "application/json" }, body: JSON.stringify({ name: "Corner Store latte — Guard Check",
              description: JSON.stringify({ mandateBundle: bundle, proposal: local.proposal }),
              assigneeId: cfg.SOKOSUMI_COWORKER_ID, status: "READY" }) });
          if (!response.ok) throw new Error();
          const { data } = createdSchema.parse(await response.json());
          const taskToken = issueStoreTaskToken({ taskId: data.id, mandateDigest: mandateDigest(bundle.mandate),
            proposalDigest: proposalDigest(local.proposal) }, cfg.tokenKey, Math.floor(now() / 1000));
          return { mode: "hired", taskId: data.id, taskToken, steps: [...local.steps, `Guard hired on Sokosumi — Task ${data.id}`],
            proposal: local.proposal, local, ...(live ? { live: true, bundle } : {}) };
        } catch { return fallback("Guard could not be hired — showing the local check"); }
      })();
      if (key) requests.set(key, { at: time, fingerprint, result });
      return json(await result);
    },
    async status(taskId: string, taskToken?: string | null, expectedProposalDigest?: string | null, request?: Request): Promise<Response> {
      const cfg = config();
      const claims = cfg && readStoreTaskToken(taskToken, cfg.tokenKey, Math.floor(now() / 1000));
      const live = request !== undefined && hasStoreLiveKey(request, options.env());
      if (!cfg || !claims || !expectedProposalDigest || !StoreTaskIdSchema.safeParse(taskId).success
        || claims.taskId !== taskId || claims.proposalDigest !== expectedProposalDigest
        || (!live && claims.mandateDigest !== mandateDigest(options.bundle.mandate))) return json({ error: "Invalid store Task authorization" }, 403);
      const expectedMandateDigest = claims.mandateDigest;
      const signal = AbortSignal.timeout(8000);
      const data = await loadReceipt(taskId, { origin: cfg.origin, apiKey: cfg.SOKOSUMI_COWORKER_API_KEY,
        guardAddress: cfg.GUARD_ADDRESS,
        // Live polling must not inherit the public receipt viewer's 60-second data cache.
        fetch: (input, init) => options.fetch(input, { ...init, next: undefined, cache: "no-store", signal }) });
      if (data.kind === "unreachable") return json({ status: "pending" });
      if (data.kind === "in-progress") return data.status === "FAILED" ? failed("Guard Task failed — showing the local check") : json({ status: "pending" });
      if (data.kind !== "receipt" || !data.receiptValid || data.digests.mandate !== expectedMandateDigest
        || data.digests.proposal !== expectedProposalDigest) return failed("Signed Guard Receipt could not be verified — showing the local check");
      if (live && (!data.bundle || !data.inputsBound || data.bundle.digest !== expectedMandateDigest
        || mandateDigest(data.bundle.mandate) !== expectedMandateDigest)) return failed("Signed Guard Receipt could not be verified — showing the local check");
      return json({ status: "completed", receiptValid: true, verdict: data.verdict, reasons: data.reasons, diff: data.diff,
        mandateDigest: data.digests.mandate, proposalDigest: data.digests.proposal });
    },
  };
}
