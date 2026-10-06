import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { LandingScene } from "./LandingScene";
import { Cheque } from "./Cheque";
import { Stamp } from "./Stamp";
import { landingBundle, landingProposal, landingVerdict, presentedDigest } from "./landing";
import { Desk } from "./Desk";

describe("teller's desk", () => {
  it("server-renders the final composed refusal with computed reasons, rings and stub", () => {
    const verdict = landingVerdict(landingBundle.mandate.expiry - 3600);
    expect(verdict.reasons).toEqual(["PAYEE_MISMATCH", "AMOUNT_MISMATCH"]);
    const html = renderToStaticMarkup(h(LandingScene, { reasons: verdict.reasons,
      signed: h(Cheque, { bundle: landingBundle, heading: null, tilt: -1.2 }),
      presented: h(Cheque, { bundle: landingBundle, heading: null, tilt: 2.5, patternDigest: presentedDigest,
        presented: { payee: landingProposal.requirements.payTo, amount: landingProposal.requirements.amount },
        pencilRings: true, stamp: h(Stamp, { reasons: verdict.reasons }) }),
    }));
    expect(html).toContain("RETURN ITEM · AgentPay Guard · Guard Check");
    expect(html).toContain("Reason: REFER TO MAKER");
    expect(html).toContain("PAYEE_MISMATCH · AMOUNT_MISMATCH");
    expect(html).toContain('aria-label="RETURNED: PAYEE_MISMATCH, AMOUNT_MISMATCH"');
    expect(html.match(/class="pencil-ring"/g)).toHaveLength(2);
    expect(html).toContain('class="paper-clip"');
    expect(html).toContain(landingBundle.mandate.nonce.slice(0, 8));
    expect(html).not.toContain("data-step=");
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(css).toContain('.landing-sequence[data-step="0"]');
  });
  it("uses an inert tiled desk surface and readable desk text", () => {
    const html = renderToStaticMarkup(h(Desk, { children: "content" }));
    expect(html).toContain('class="desk-surface" aria-hidden="true"');
    expect(html).toContain("data:image/svg+xml");
    expect(html).not.toContain("<filter");
    const luminance = (hex: string) => {
      const rgb = hex.match(/\w\w/g)!.map((v) => parseInt(v, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    };
    for (const color of ["e6ede7", "c3d1c9"]) expect((luminance(color) + .05) / (luminance("1d3b33") + .05)).toBeGreaterThanOrEqual(4.5);
  });
});
