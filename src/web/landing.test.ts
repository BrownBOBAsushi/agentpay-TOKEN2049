import { expect, test } from "vitest";
import { guillochePaths, guillocheBorderPaths } from "./guilloche";
import { landingBundle, landingProposal, landingVerdict, presentedDigest } from "./landing";
import { guardCheck } from "../guard/check";
import { proposalDigest } from "../guard/receipt";
import { atomicToDecimal, groupAtomic } from "./amount";

test("guilloche is deterministic and reacts to one changed digest byte", () => {
  const digest = landingBundle.digest;
  const paths = guillochePaths(digest);
  expect(paths.length).toBeGreaterThanOrEqual(40);
  expect(paths.length).toBeLessThanOrEqual(70);
  expect(paths).toEqual(guillochePaths(digest));
  expect(paths).not.toEqual(guillochePaths(`${digest.slice(0, -2)}${digest.endsWith("00") ? "01" : "00"}`));
  expect(paths.every((path) => path.startsWith("M") && path.endsWith("Z") && !path.includes("NaN"))).toBe(true);
  expect(paths).not.toEqual(guillochePaths(presentedDigest));
  expect(presentedDigest).toBe(proposalDigest(landingProposal));
  expect(guillocheBorderPaths(digest)).toEqual(guillocheBorderPaths(digest));
  expect(guillocheBorderPaths(digest)).not.toEqual(guillocheBorderPaths(presentedDigest));
  for (const path of paths) {
    const points = path.match(/[ML]([\d.]+),([\d.]+)/g)!;
    expect(points[0].slice(1)).toBe(points.at(-1)!.slice(1));
  }
});

test.each([
  ["2000000", "2", "2,000,000"], ["9000000", "9", "9,000,000"],
  ["1", "0.000001", "1"], ["1234567", "1.234567", "1,234,567"],
  ["9007199254740993123456", "9007199254740993.123456", "9,007,199,254,740,993,123,456"],
])("atomic amount %s renders without floating-point loss", (atomic, human, grouped) => {
  expect(atomicToDecimal(atomic)).toBe(human);
  expect(groupAtomic(atomic)).toBe(grouped);
});

test("landing refusal is a cryptographic Guard Check with the two real differences", () => {
  const nowSec = landingBundle.mandate.expiry - 3600;
  expect(landingVerdict(nowSec)).toMatchObject({ verdict: "REFUSE", reasons: ["PAYEE_MISMATCH", "AMOUNT_MISMATCH"] });
  expect(guardCheck({ bundle: landingBundle, proposal: { ...landingProposal, requirements: {
    ...landingProposal.requirements, payTo: landingBundle.mandate.payee, amount: landingBundle.mandate.amount,
  } } }, { nowSec, nonceUsed: false }).verdict).toBe("APPROVE");
});
