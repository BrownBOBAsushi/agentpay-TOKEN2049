import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import s1 from "../../public/demo-runs/s1.json";
import s2 from "../../public/demo-runs/s2.json";
import { parseDemoRun } from "./demo-runs";
import { DemoArena, DemoRun } from "./DemoArena";
import { replaySteps } from "./demo-replay";

const runs = { S1: parseDemoRun(s1, "S1"), S2: parseDemoRun(s2, "S2") };
const render = (scenario: "S1" | "S2") => renderToStaticMarkup(h(DemoRun, { run: runs[scenario] }));
afterEach(() => vi.useRealTimers());

it("renders S1 PAID with the exact preprod transaction and receipt links", () => {
  const html = render("S1");
  expect(html).toContain("PAID");
  expect(html).toContain(`href="https://preprod.cardanoscan.io/transaction/${s1.payment.txHash}"`);
  expect(html).toContain(`href="/receipt/${s1.taskId}"`);
  expect(html).not.toContain("No payment made");
});
it("renders S2 RETURNED, every Diff row, reasons and no payment", () => {
  const html = render("S2");
  expect(html).toContain("RETURNED"); expect(html).toContain("No payment made");
  expect(html).toContain(`href="/receipt/${s2.taskId}"`);
  for (const row of s2.diff) for (const value of Object.values(row)) expect(html).toContain(value);
  for (const reason of s2.reasons) expect(html).toContain(reason);
  expect(html).toContain(s2.injectedExcerpt); expect(html).toContain("pencil-ring");
  expect(html).not.toContain("https://preprod.cardanoscan.io/transaction/");
});
it.each(["S1", "S2"] as const)("labels an unrecorded %s run as an example, and a recorded one not", (scenario) => {
  // The published runs are real preprod runs (docs/EVIDENCE.md M4).
  expect(runs[scenario].recorded).toBe(true);
  expect(render(scenario)).not.toContain("Example run — not yet recorded on preprod");
  const html = renderToStaticMarkup(h(DemoRun, { run: { ...runs[scenario], recorded: false } }));
  expect(html).toContain("Example run — not yet recorded on preprod");
});
it("rejects invalid transcript data with a file and field error, and wrong scenario files", () => {
  expect(() => parseDemoRun({ ...s1, payment: { ...s1.payment, txHash: "invalid" } }, "S1"))
    .toThrow("Invalid demo transcript public/demo-runs/s1.json: payment.txHash");
  expect(() => parseDemoRun({ ...s2, recorded: undefined }, "S2"))
    .toThrow("Invalid demo transcript public/demo-runs/s2.json: recorded");
  expect(() => parseDemoRun(s2, "S1")).toThrow("expected scenario S1");
});
it("renders scenario buttons with pressed state and a complete ordered log before replay", () => {
  const html = renderToStaticMarkup(h(DemoArena, { runs }));
  expect(html).toContain('aria-pressed="true"'); expect(html).toContain('aria-pressed="false"');
  expect(html).toContain("S1 — honest offer"); expect(html).toContain("S2 — injected offer");
  expect(html).toContain('<ol'); expect(html).toContain('aria-label="Run log"');
  expect(html).toContain(">Replay</button>");
  let previous = -1;
  for (const step of s1.steps) {
    const index = html.indexOf(step.text.replaceAll("&", "&amp;"), html.indexOf('<ol'));
    expect(index).toBeGreaterThan(previous); previous = index;
  }
});
it("escapes injected text, preserves incomplete outcomes, and does not invent missing links", () => {
  const run = { ...runs.S2, injectedExcerpt: '<script>alert("injected")</script>', taskId: null, verdict: null, diff: [], reasons: [] };
  const html = renderToStaticMarkup(h(DemoRun, { run }));
  expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
  expect(html).toContain("Run stopped"); expect(html).not.toContain('href="/receipt/');
  const pending = renderToStaticMarkup(h(DemoRun, { run: { ...runs.S1, payment: { ...runs.S1.payment!, status: "pending" } } }));
  expect(pending).toContain("Payment pending"); expect(pending).not.toContain(">PAID<");
});
it("replays in order at 400 ms, and cancellation allows a clean restart", () => {
  vi.useFakeTimers(); const progress = vi.fn();
  const cancel = replaySteps(3, false, progress);
  expect(progress.mock.calls).toEqual([[0]]);
  vi.advanceTimersByTime(400); expect(progress.mock.calls).toEqual([[0], [1]]);
  cancel(); vi.advanceTimersByTime(800); expect(progress).toHaveBeenCalledTimes(2);
  const restarted = vi.fn(); replaySteps(3, false, restarted);
  vi.advanceTimersByTime(1200); expect(restarted.mock.calls).toEqual([[0], [1], [2], [3]]);
  expect(vi.getTimerCount()).toBe(0);
});
it("shows every line immediately for reduced motion or an empty log without scheduling", () => {
  vi.useFakeTimers(); const progress = vi.fn();
  replaySteps(9, true, progress); expect(progress.mock.calls).toEqual([[9]]);
  replaySteps(0, false, progress); expect(progress).toHaveBeenLastCalledWith(0);
  expect(vi.getTimerCount()).toBe(0);
});
