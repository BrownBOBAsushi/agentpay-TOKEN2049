import { expect, test } from "vitest";
import { guillochePaths } from "./guilloche";
import { landingBundle, landingProposal, landingVerdict, presentedDigest } from "./landing";
import { guardCheck } from "../guard/check";

test("guilloche is deterministic and reacts to one changed digest byte", () => {
  const digest = landingBundle.digest;
  const paths = guillochePaths(digest);
  expect(paths).toEqual(guillochePaths(digest));
  expect(paths).not.toEqual(guillochePaths(`${digest.slice(0, -2)}${digest.endsWith("00") ? "01" : "00"}`));
  expect(paths.every((path) => path.startsWith("M") && path.endsWith("Z") && !path.includes("NaN"))).toBe(true);
  expect(paths).not.toEqual(guillochePaths(presentedDigest));
});

test("landing refusal is a cryptographic Guard Check with the two real differences", () => {
  const nowSec = landingBundle.mandate.expiry - 3600;
  expect(landingVerdict(nowSec)).toMatchObject({ verdict: "REFUSE", reasons: ["PAYEE_MISMATCH", "AMOUNT_MISMATCH"] });
  expect(guardCheck({ bundle: landingBundle, proposal: { ...landingProposal, requirements: {
    ...landingProposal.requirements, payTo: landingBundle.mandate.payee, amount: landingBundle.mandate.amount,
  } } }, { nowSec, nonceUsed: false }).verdict).toBe("APPROVE");
});
