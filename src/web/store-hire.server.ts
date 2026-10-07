import "server-only";
import { z } from "zod";
import type { MandateBundle } from "../guard/bundle";
import { MandateSchema } from "../guard/mandate";
import { mandateDigest } from "../guard/digest";
import { proposalDigest } from "../guard/receipt";
import { preprodOrigin } from "../worker/config";
import { loadReceipt } from "./receipt-data.server";
import { StoreRequestSchema, type StoreResult } from "./store-contract";
import { StoreTaskIdSchema } from "./store-hire-contract";
import { runStoreCheck } from "./store-check";

const configSchema = z.object({ SOKOSUMI_API_URL: z.string().min(1), SOKOSUMI_COWORKER_API_KEY: z.string().min(1),
  SOKOSUMI_COWORKER_ID: z.string().min(1), SOKOSUMI_TASK_USER_ID: z.string().min(1), GUARD_ADDRESS: MandateSchema.shape.payer });
const createdSchema = z.object({ data: z.object({ id: StoreTaskIdSchema }) });
const hour = 3_600_000;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const failed = (note: string) => json({ status: "failed", receiptValid: false, note });

export function createStoreHireService(options: { bundle: MandateBundle; env: () => Record<string, string | undefined>;
  fetch: typeof fetch; now?: () => number }) {
  const now = options.now ?? (() => Date.now());
  const tasks = new Map<string, { created: number; local: StoreResult }>();
  const attempts: { at: number; ip: string }[] = [];
  const requests = new Map<string, { at: number; injection: string | null; result: Promise<unknown> }>();
  function config() {
    const parsed = configSchema.safeParse(options.env());
    if (!parsed.success) return null;
    try { return { ...parsed.data, origin: preprodOrigin(parsed.data.SOKOSUMI_API_URL) }; } catch { return null; }
  }
  return {
    async hire(request: Request): Promise<Response> {
      let body: unknown;
      try { body = await request.json(); } catch { body = null; }
      const parsed = StoreRequestSchema.safeParse(body);
      if (!parsed.success) return json({ error: "Send injection as a string of at most 500 characters, or null." }, 400);
      const local = runStoreCheck(parsed.data.injection, options.bundle, Math.floor(now() / 1000));
      const fallback = (note: string) => ({ ...local, mode: "local", note, steps: [...local.steps, note] });
      if (local.verdict === "APPROVE") return json(fallback("APPROVE is not hired on the public page — one-time Mandate; see the recorded paid run"));
      const cfg = config();
      if (!cfg) return json(fallback("Guard hiring is not configured — showing the local check"));
      const time = now();
      while (attempts[0] && attempts[0].at <= time - hour) attempts.shift();
      for (const [id, entry] of tasks) if (entry.created <= time - hour) tasks.delete(id);
      for (const [id, entry] of requests) if (entry.at <= time - hour) requests.delete(id);
      const ip = (request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown").slice(0, 128);
      const requestId = z.uuid().safeParse(request.headers.get("x-store-request-id"));
      const key = requestId.success ? `${ip}:${requestId.data}` : null;
      const previous = key ? requests.get(key) : undefined;
      if (previous) return json(previous.injection === parsed.data.injection ? await previous.result
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
              description: JSON.stringify({ mandateBundle: options.bundle, proposal: local.proposal }),
              assigneeId: cfg.SOKOSUMI_COWORKER_ID, status: "READY" }) });
          if (!response.ok) throw new Error();
          const { data } = createdSchema.parse(await response.json());
          if (tasks.has(data.id)) throw new Error();
          tasks.set(data.id, { created: time, local });
          return { mode: "hired", taskId: data.id, steps: [...local.steps, `Guard hired on Sokosumi — Task ${data.id}`],
            proposal: local.proposal, local };
        } catch { return fallback("Guard could not be hired — showing the local check"); }
      })();
      if (key) requests.set(key, { at: time, injection: parsed.data.injection, result });
      return json(await result);
    },
    async status(taskId: string): Promise<Response> {
      const entry = tasks.get(taskId);
      if (!StoreTaskIdSchema.safeParse(taskId).success || !entry || now() - entry.created >= hour) return json({ error: "Unknown store Task" }, 404);
      const cfg = config();
      if (!cfg) return failed("Guard hiring is unavailable — showing the local check");
      const signal = AbortSignal.timeout(8000);
      const data = await loadReceipt(taskId, { origin: cfg.origin, apiKey: cfg.SOKOSUMI_COWORKER_API_KEY,
        guardAddress: cfg.GUARD_ADDRESS,
        // Live polling must not inherit the public receipt viewer's 60-second data cache.
        fetch: (input, init) => options.fetch(input, { ...init, next: undefined, cache: "no-store", signal }) });
      if (data.kind === "unreachable") return json({ status: "pending" });
      if (data.kind === "in-progress") return data.status === "FAILED" ? failed("Guard Task failed — showing the local check") : json({ status: "pending" });
      if (data.kind !== "receipt" || !data.receiptValid || data.digests.mandate !== mandateDigest(options.bundle.mandate)
        || data.digests.proposal !== proposalDigest(entry.local.proposal)) return failed("Signed Guard Receipt could not be verified — showing the local check");
      return json({ status: "completed", receiptValid: true, verdict: data.verdict, reasons: data.reasons, diff: data.diff,
        mandateDigest: data.digests.mandate, proposalDigest: data.digests.proposal });
    },
  };
}
