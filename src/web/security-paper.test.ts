import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { twoInkGuilloche, guillocheWaveStrands } from "./guilloche";
import { SecurityPaper, EngravedSeal } from "./SecurityPaper";
import { Cheque } from "./Cheque";
import { landingBundle, landingProposal } from "./landing";

test("both ink plates are deterministic, sensitive and have different lobe counts", () => {
  const digest = landingBundle.digest;
  const plates = twoInkGuilloche(digest);
  expect(plates).toEqual(twoInkGuilloche(digest));
  expect(plates.firstLobes).not.toBe(plates.secondLobes);
  const changed = twoInkGuilloche(`${digest.slice(0, -2)}${digest.endsWith("00") ? "01" : "00"}`);
  expect(plates.sage).not.toEqual(changed.sage); expect(plates.bronze).not.toEqual(changed.bronze);
  expect(plates.bronze).toEqual(twoInkGuilloche(`${digest.startsWith("00") ? "01" : "00"}${digest.slice(2)}`).bronze);
  for (const plate of [plates.sage, plates.bronze]) {
    expect(plate.length).toBeGreaterThanOrEqual(40); expect(plate.length).toBeLessThanOrEqual(70);
    expect(plate.every((path) => path.startsWith("M") && path.endsWith("Z") && !path.includes("NaN"))).toBe(true);
  }
});
test("wave band has four interlaced strands bounded within nine pixels", () => {
  for (const vertical of [false, true]) {
    const strands = guillocheWaveStrands(vertical);
    expect(new Set(strands).size).toBe(4);
    for (const path of strands) {
      const points = [...path.matchAll(/[ML]([\d.]+),([\d.]+)/g)];
      for (const point of points) expect(Number(point[vertical ? 1 : 2])).toBeGreaterThanOrEqual(.5);
      for (const point of points) expect(Number(point[vertical ? 1 : 2])).toBeLessThanOrEqual(8.5);
      expect(points[0][vertical ? 1 : 2]).toBe(points.at(-1)![vertical ? 1 : 2]);
    }
  }
});
test.each([false, true])("COPY belongs only to a presented cheque (%s)", (presented) => {
  const html = renderToStaticMarkup(createElement(Cheque, { bundle: landingBundle, heading: "Mandate",
    ...(presented ? { presented: { payee: landingProposal.requirements.payTo, amount: landingProposal.requirements.amount } } : {}) }));
  expect(html.includes('data-pantograph="COPY"')).toBe(presented);
  expect(html.includes(">COPY</text>")).toBe(presented);
  expect(html).toContain('class="security-paper" aria-hidden="true"');
  expect(html).toContain('class="microprint frame-microprint"');
  expect(html).toContain('baseFrequency=".9"'); expect(html).not.toContain("<image");
});
test("unsigned edit paper has uniform dots, no invented digest and a hidden seal", () => {
  const html = renderToStaticMarkup(createElement(SecurityPaper, { digest: null }));
  expect(html).not.toContain("COPY"); expect(html).not.toContain('class="guilloche-field"');
  expect(html).toContain('class="pantograph"');
  const seal = renderToStaticMarkup(createElement(EngravedSeal));
  expect(seal).toContain('aria-hidden="true"'); expect(seal).toContain('viewBox="0 0 60 60"');
});

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const blend = (front: number[], back: number[], alpha: number) => front.map((channel, i) => channel * alpha + back[i] * (1 - alpha));
const luminance = (color: number[]) => color.reduce((sum, channel, i) => sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i], 0);

test("all value ink colours clear 4.5:1 even against a maximally dark texture", () => {
  // Black is a conservative mathematical bound, not a colour added to the design.
  const background = blend(rgb("#e4ecef"), [0, 0, 0], .92);
  for (const ink of ["#16303a", "#4a5f67", "#b3261e"]) {
    expect((luminance(background) + .05) / (luminance(rgb(ink)) + .05)).toBeGreaterThanOrEqual(4.5);
  }
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  expect(css).toContain("background-color: rgb(228 236 239 / 92%)");
  expect(css).toMatch(/@media \(prefers-contrast: more\)[\s\S]*\.pantograph, \.paper-grain, \.microprint \{ display: none; \}/);
});
