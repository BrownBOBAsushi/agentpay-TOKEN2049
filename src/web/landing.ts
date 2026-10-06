import fixture from "./fixtures/landing-s2.json";
import { guardCheck } from "../guard/check";
import { MandateBundleSchema } from "../guard/bundle";
import { mandateDigest } from "../guard/digest";

export const landingBundle = MandateBundleSchema.parse(fixture.mandateBundle);
export const landingProposal = fixture.proposal;
export const presentedDigest = mandateDigest({ ...landingBundle.mandate,
  payee: landingProposal.requirements.payTo, amount: landingProposal.requirements.amount });
export function landingVerdict(nowSec: number) {
  return guardCheck({ bundle: fixture.mandateBundle, proposal: fixture.proposal }, { nowSec, nonceUsed: false });
}
