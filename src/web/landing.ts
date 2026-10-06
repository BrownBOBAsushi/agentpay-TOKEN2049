import fixture from "./fixtures/landing-s2.json";
import { guardCheck } from "../guard/check";
import { MandateBundleSchema } from "../guard/bundle";
import { proposalDigest } from "../guard/receipt";
import { SpendProposalSchema } from "../guard/proposal";

export const landingBundle = MandateBundleSchema.parse(fixture.mandateBundle);
export const landingProposal = SpendProposalSchema.parse(fixture.proposal);
export const presentedDigest = proposalDigest(landingProposal);
export function landingVerdict(nowSec: number) {
  return guardCheck({ bundle: fixture.mandateBundle, proposal: fixture.proposal }, { nowSec, nonceUsed: false });
}
