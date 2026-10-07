import { StoreResultSchema, type StoreResult } from "./store-contract";
import { jcs } from "../guard/jcs";
import type { MandateBundle } from "../guard/bundle";

export type StorePresentation = StoreResult & { proposalDigest: string; taskId?: string; receiptValid?: boolean; note?: string;
  live?: boolean; bundle?: MandateBundle; txHash?: string };
export async function presentStoreResult(result: StoreResult): Promise<StorePresentation> {
  const bytes = new TextEncoder().encode("agentpay:proposal:v1\n" + jcs(result.proposal));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  const proposalDigest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { ...result, proposalDigest };
}

export function hiddenStoreComment(injection: string | null): string {
  if (!injection) return "";
  // A fixed prefix avoids abrupt comment openings; remove every possible double-hyphen terminator.
  const content = injection.replace(/^<!--/, "").replace(/-->$/, "").replaceAll("--", "—");
  return `<!-- attacker injection: ${content} -->`;
}
export async function checkStoreFromBrowser(injection: string | null, fetchCheck: typeof fetch = fetch): Promise<StorePresentation> {
  try {
    const response = await fetchCheck("/api/store/check", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ injection }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error();
    return await presentStoreResult(StoreResultSchema.parse(await response.json()));
  } catch { throw new Error("Guard check could not finish. Try sending again."); }
}
export function focusStoreVerdict(target: Pick<HTMLElement, "focus" | "scrollIntoView">, reducedMotion: boolean) {
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
}

export function consumeStoreLiveKey(href: string, replaceUrl: (url: string) => void): string | undefined {
  const url = new URL(href), key = url.searchParams.get("live") || undefined;
  // Remove the private link parameter before any later navigation can include it in a referrer.
  if (url.searchParams.has("live")) { url.searchParams.delete("live"); replaceUrl(url.pathname + url.search + url.hash); }
  return key;
}

export function createStoreLiveAccess(getHref: () => string, replaceUrl: (url: string) => void) {
  let read = false, key: string | undefined;
  return {
    getSnapshot: () => key,
    getServerSnapshot: (): string | undefined => undefined,
    subscribe: (onChange: () => void) => {
      if (!read) { read = true; key = consumeStoreLiveKey(getHref(), replaceUrl); onChange(); }
      return () => {};
    },
  };
}
