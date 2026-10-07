import { StoreHireSchema, StoreHireStatusSchema } from "./store-hire-contract";
import { checkStoreFromBrowser, presentStoreResult, type StorePresentation } from "./store-browser";

export async function hireStoreFromBrowser(injection: string | null, options: { fetch?: typeof fetch;
  now?: () => number; wait?: (ms: number) => Promise<void>; onSteps?: (steps: string[]) => void } = {}): Promise<StorePresentation> {
  const fetcher = options.fetch ?? fetch, now = options.now ?? (() => Date.now());
  const wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let hired;
  try {
    const response = await fetcher("/api/store/hire", { method: "POST", headers: { "Content-Type": "application/json",
      "X-Store-Request-Id": crypto.randomUUID() }, body: JSON.stringify({ injection }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error();
    hired = StoreHireSchema.parse(await response.json());
  } catch {
    // Do not retry Task creation: a transport failure may have happened after the Task was created.
    const local = await checkStoreFromBrowser(injection, fetcher);
    const note = "Guard could not be hired — showing the local check";
    return { ...local, note, steps: [...local.steps, note] };
  }
  if (hired.mode === "local") return { ...await presentStoreResult(hired), note: hired.note };
  const local = await presentStoreResult(hired.local);
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
        method: "GET", cache: "no-store", headers: { "X-Store-Task-Token": hired.taskToken,
          "X-Store-Proposal-Digest": local.proposalDigest }, signal: AbortSignal.timeout(Math.min(10_000, remaining)) });
      if ([401, 403, 404].includes(response.status)) return fallback("Guard Task authorization is unavailable or expired — showing the local check");
      if (!response.ok) continue;
      const status = StoreHireStatusSchema.parse(await response.json());
      if (now() >= deadline) break;
      if (status.status === "failed") return fallback(status.note);
      if (status.status === "completed") {
        if (status.proposalDigest !== local.proposalDigest) return fallback("Signed Guard Receipt could not be verified — showing the local check");
        return { ...local, verdict: status.verdict, reasons: status.reasons, diff: status.diff,
          taskId: hired.taskId, receiptValid: true, steps: [...steps, "Signed Guard Receipt verified"] };
      }
    } catch { /* A read can be retried within the deadline; never repeat the hire. */ }
  }
  return fallback("Guard did not answer in 60 s — showing the local check");
}
