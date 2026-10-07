"use client";

import { useEffect, useRef, useState } from "react";
import type { RunTranscript } from "../orchestrator/transcript";
import { PaperObject } from "./PaperObject";
import { PencilRing, ReturnItem } from "./LandingScene";
import { Stamp } from "./Stamp";
import { replaySteps } from "./demo-replay";
import styles from "./demo.module.css";

function ReplayLog({ run }: { run: RunTranscript }) {
  // A complete static log is also the server-rendered and no-JavaScript view.
  const [visible, setVisible] = useState<number | null>(null);
  const cancel = useRef<() => void>(() => {});
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      if (motion.matches) { cancel.current(); setVisible(null); }
    };
    motion.addEventListener("change", change);
    return () => { cancel.current(); motion.removeEventListener("change", change); };
  }, []);
  const replay = () => {
    cancel.current();
    cancel.current = replaySteps(run.steps.length, window.matchMedia("(prefers-reduced-motion: reduce)").matches, setVisible);
  };
  const count = visible ?? run.steps.length;
  return <section className={styles.ledger} aria-labelledby="run-log-title">
    <div className={styles.logHeading}><h2 id="run-log-title">Run log</h2><button type="button" onClick={replay}>Replay</button></div>
    <p className={styles.logStatus} role="status">{visible === null ? "Saved steps · full log" : count < run.steps.length ? "Replaying the saved steps…" : "Replay complete"}</p>
    <ol className={`value ${styles.log}`} aria-label="Run log">
      {run.steps.map((step, index) => <li key={`${step.at}-${index}`} hidden={index >= count}>
        <time dateTime={step.at}>{step.at.slice(11, 19)}</time><span>{step.text}</span>
      </li>)}
    </ol>
  </section>;
}

export function DemoRun({ run }: { run: RunTranscript }) {
  const instructions = run.steps.filter((step) => step.kind === "instruction" && step.text !== run.injectedExcerpt);
  const returned = run.verdict === "REFUSE" && run.payment === null;
  const paid = run.verdict === "APPROVE" && (run.payment?.status === "confirmed" || run.payment?.status === "confirmed-on-chain");
  return <section id="selected-run" aria-label={`${run.scenario} run`}>
    {!run.recorded && <p className={styles.example}>Example run — not yet recorded on preprod</p>}
    <div className={styles.deskRun}>
      <section className={styles.offer} aria-labelledby="offer-title">
        <PaperObject tilt={-1.2} stub={<><span className="value">{run.scenario}</span><span>Offer excerpt</span><time className="value" dateTime={run.startedAt}>{run.startedAt.slice(0, 10)}</time><span>Cardano<br />preprod</span></>}>
          <div className={styles.note}>
            <h2 id="offer-title">{run.scenario === "S1" ? "The honest offer" : "The injected offer"}</h2>
            <p className={`value ${styles.source}`}>{run.offerUrl}</p>
            <p>The agent follows the last payment instruction on the page.</p>
            {instructions.map((step, index) => <p className={`value ${styles.instruction}`} key={index}>{step.text}</p>)}
            {run.injectedExcerpt !== null && <div className={styles.injection}>
              <p>Injected text · revealed</p><span className="ring-target"><span className="value">{run.injectedExcerpt}</span><PencilRing fit /></span>
            </div>}
            {instructions.length === 0 && run.injectedExcerpt === null && <p>No instruction was captured.</p>}
          </div>
        </PaperObject>
      </section>
      <ReplayLog run={run} />
      <ReturnItem className={styles.outcome} reasons={run.reasons} title="AgentPay Guard · Guard Check" label="Run outcome">
        <h2>{returned ? "RETURNED" : paid ? "PAID" : run.payment ? "Payment pending" : "Run stopped"}</h2>
        {returned ? <>
          <div className={styles.verdictStamp}><Stamp reasons={run.reasons} /></div>
          <dl className={styles.diff} aria-label="Diff: signed Mandate and presented proposal">
            {run.diff.map((row, index) => <div key={`${row.field}-${index}`}>
              <dt>{row.field}</dt><dd><span>Signed</span><span className="value">{row.signed}</span></dd>
              <dd><span>Presented</span><span className="value">{row.proposed}</span></dd>
            </div>)}
          </dl>
          <p className={styles.paymentNote}>No payment made</p>
        </> : paid ? <><div className={styles.verdictStamp}><Stamp variant="cleared" /></div>
          <p className={styles.paymentNote}>{run.payment!.status === "confirmed-on-chain" ? "Confirmed on chain · seller response not received" : "Approved payment confirmed"}</p>
        </> : <p className={styles.paymentNote}>This run has no confirmed payment outcome.</p>}
        {run.payment && <p className={styles.proof}><a href={`https://preprod.cardanoscan.io/transaction/${run.payment.txHash}`}>View transaction on Cardanoscan (preprod)</a><span className="value">{run.payment.txHash}</span></p>}
        {run.taskId && <p className={styles.proof}><a href={`/receipt/${encodeURIComponent(run.taskId)}`}>Read the Guard Receipt</a><span className="value">{run.taskId}</span></p>}
      </ReturnItem>
    </div>
  </section>;
}

export function DemoArena({ runs }: { runs: Record<RunTranscript["scenario"], RunTranscript> }) {
  const [scenario, setScenario] = useState<RunTranscript["scenario"]>("S1");
  return <>
    <div className={styles.scenarios} role="group" aria-label="Choose a run">
      <button type="button" aria-pressed={scenario === "S1"} aria-controls="selected-run" onClick={() => setScenario("S1")}>S1 — honest offer</button>
      <button type="button" aria-pressed={scenario === "S2"} aria-controls="selected-run" onClick={() => setScenario("S2")}>S2 — injected offer</button>
    </div>
    <DemoRun key={scenario} run={runs[scenario]} />
  </>;
}
