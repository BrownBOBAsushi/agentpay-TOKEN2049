import type { Mandate } from "./mandate";
import type { X402Requirements } from "./proposal";
import type { DiffEntry, ReasonCode, Verdict } from "./verdict";

export function matchX402(mandate: Mandate, requirements: X402Requirements, nowSec: number): Pick<Verdict, "reasons" | "diff"> {
  const reasons: ReasonCode[] = [];
  const diff: DiffEntry[] = [];
  const fields: [string, string, string, ReasonCode][] = [
    ["network", mandate.network, requirements.network, "NETWORK_MISMATCH"],
    ["scheme", "exact", requirements.scheme, "SCHEME_MISMATCH"],
    ["payee", mandate.payee, requirements.payTo, "PAYEE_MISMATCH"],
    ["asset", mandate.asset, requirements.asset, "ASSET_MISMATCH"],
    ["amount", mandate.amount, requirements.amount, "AMOUNT_MISMATCH"],
  ];
  for (const [field, signed, proposed, reason] of fields) {
    if (signed !== proposed) {
      reasons.push(reason);
      diff.push({ field, signed, proposed });
    }
  }

  const deadline = nowSec + requirements.maxTimeoutSeconds;
  if (deadline > mandate.expiry) {
    reasons.push("DEADLINE_AFTER_EXPIRY");
    diff.push({ field: "deadline", signed: String(mandate.expiry), proposed: String(deadline) });
  }
  return { reasons, diff };
}
