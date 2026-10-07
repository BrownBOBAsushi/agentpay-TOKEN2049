import { StoreHireSchema, StoreHireStatusSchema } from "./store-hire-contract";
import { z } from "zod";
import { checkStoreFromBrowser, presentStoreResult, type StorePresentation } from "./store-browser";

export async function hireStoreFromBrowser(injection: string | null, options: { fetch?: typeof fetch;
  now?: () => number; wait?: (ms: number) => Promise<void>; onSteps?: (steps: string[]) => void;
  liveKey?: string; mandateBundle?: unknown } = {}): Promise<StorePresentation> {
  const fetcher = options.fetch ?? fetch, now = options.now ?? (() => Date.now());
  const wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const liveHeaders: Record<string, string> = options.liveKey ? { "x-store-live-key": options.liveKey } : {};
  let hired;
  try {
    const response = await fetcher("/api/store/hire", { method: "POST", redirect: "error", headers: { "Content-Type": "application/json",
      "X-Store-Request-Id": crypto.randomUUID(), ...liveHeaders }, body: JSON.stringify({ injection,
        ...(options.liveKey && options.mandateBundle !== undefined ? { mandateBundle: options.mandateBundle } : {}) }), signal: AbortSignal.timeout(25_000) });
    if (!response.ok) throw new Error();
    hired = StoreHireSchema.parse(await response.json());
  } catch {
    if (options.liveKey) throw new Error("Live hire stopped. Check the signed Mandate and store availability. Nothing paid; no hire retry was sent.");
    // Do not retry Task creation: a transport failure may have happened after the Task was created.
    const local = await checkStoreFromBrowser(injection, fetcher);
    const note = "Guard could not be hired — showing the local check";
    return { ...local, note, steps: [...local.steps, note] };
  }
  if (hired.mode === "local") return { ...await presentStoreResult(hired), note: hired.note };
  const local = { ...await presentStoreResult(hired.local), ...(hired.live && options.liveKey ? { live: true, bundle: hired.bundle } : {}) };
  const steps = [...hired.steps, "Guard is checking…"];
  options.onSteps?.(steps);
  const fallback = (note: string): StorePresentation => ({ ...local, taskId: hired.taskId, receiptValid: false,
    note, steps: [...steps, note] });
  const deadline = now() + 60_000;
  while (now() < deadline) {
    await wait(Math.min(2000, deadline - now()));
    const remaining = deadline - now();
    if (remaining <= 0) break;
    try {
      const response = await fetcher(`/api/store/hire/${encodeURIComponent(hired.taskId)}`, {
        method: "GET", redirect: "error", cache: "no-store", headers: { "X-Store-Task-Token": hired.taskToken,
          "X-Store-Proposal-Digest": local.proposalDigest, ...liveHeaders }, signal: AbortSignal.timeout(Math.min(10_000, remaining)) });
      if ([401, 403, 404].includes(response.status)) return fallback("Guard Task authorization is unavailable or expired — showing the local check");
      if (!response.ok) continue;
      const status = StoreHireStatusSchema.parse(await response.json());
      if (now() >= deadline) break;
      if (status.status === "failed") return fallback(status.note);
      if (status.status === "completed") {
        if (status.proposalDigest !== local.proposalDigest || (local.live && (!hired.bundle || status.mandateDigest !== hired.bundle.digest))) {
          return fallback("Signed Guard Receipt could not be verified — showing the local check");
        }
        const verified: StorePresentation = { ...local, verdict: status.verdict, reasons: status.reasons, diff: status.diff,
          taskId: hired.taskId, receiptValid: true, steps: [...steps,
            local.live ? `Signed Guard Receipt verified: ${status.verdict}` : "Signed Guard Receipt verified"] };
        if (!local.live || status.verdict !== "APPROVE") return verified;
        const paying = [...verified.steps, "Paying over x402 on Cardano preprod…"];
        options.onSteps?.(paying);
        // One request only. An ambiguous failure may already have paid; the server owns recovery/idempotency.
        try {
          const response = await fetcher("/api/store/pay", { method: "POST", redirect: "error", cache: "no-store", headers: {
            "Content-Type": "application/json", ...liveHeaders }, body: JSON.stringify({ taskId: hired.taskId }), signal: AbortSignal.timeout(310_000) });
          if (!response.ok) throw new Error();
          const payment = z.object({ txHash: z.string().regex(/^[0-9a-f]{64}$/),
            status: z.enum(["confirmed", "confirmed-on-chain"]) }).parse(await response.json());
          return { ...verified, txHash: payment.txHash, steps: [...paying, `Paid: ${payment.txHash}`] };
        } catch {
          const note = "Payment not confirmed here. Check the Task, receipt and saved payment before retrying; no automatic payment retry was sent.";
          return { ...verified, note, steps: [...paying, note] };
        }
      }
    } catch { /* A read can be retried within the deadline; never repeat the hire. */ }
  }
  return fallback("Guard did not answer in 60 s — showing the local check");
}
