import type { MandateBundle } from "../guard/bundle";
import type { SpendProposal } from "../guard/proposal";
import type { DiffEntry } from "../guard/verdict";

export type ReceiptRecord = {
  kind: "receipt"; example: boolean; taskId: string; ts: number | null;
  verdict: "APPROVE" | "REFUSE"; reasons: string[]; diff: DiffEntry[]; matching: DiffEntry[];
  signatureValid: boolean; inputsBound: boolean; sentinelOk: boolean; receiptValid: boolean; invalidReasons: string[]; guardAddress: string | null;
  digests: { receipt: string | null; mandate: string | null; proposal: string | null };
  bundle: MandateBundle | null; proposal: SpendProposal | null;
  inputs: "available" | "unavailable" | "digest-mismatch";
  anchor: { kind: "example" } | { kind: "free" } | { kind: "paid"; settled: boolean; onChainState: string | null; txHash: string | null };
};
export type ReceiptPageData = ReceiptRecord | { kind: "not-found" | "not-receipt" | "unreachable" }
  | { kind: "in-progress"; status: string };
