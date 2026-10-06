import { MandateBundleSchema } from "./bundle";
import { verifyMandate } from "./cip8";
import { matchX402 } from "./match-x402";
import { SpendProposalSchema } from "./proposal";
import type { ReasonCode, Verdict } from "./verdict";

function refuse(reason: ReasonCode): Verdict {
  return { verdict: "REFUSE", reasons: [reason], diff: [] };
}

export function guardCheck(
  input: { bundle: unknown; proposal: unknown },
  context: { nowSec: number; nonceUsed: boolean },
): Verdict {
  const verification = verifyMandate(input.bundle);
  if (!verification.ok) return refuse(verification.reason);

  const { mandate } = MandateBundleSchema.parse(input.bundle);
  if (context.nowSec >= mandate.expiry) return refuse("MANDATE_EXPIRED");
  if (context.nonceUsed) return refuse("NONCE_REUSED");

  const proposal = SpendProposalSchema.safeParse(input.proposal);
  if (!proposal.success) return refuse("PROPOSAL_INVALID");
  const result = matchX402(mandate, proposal.data.requirements, context.nowSec);
  return { verdict: result.reasons.length === 0 ? "APPROVE" : "REFUSE", ...result };
}
