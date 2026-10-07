"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import Link from "next/link";
import type { MandateBundle } from "../guard/bundle";
import { STORE_INJECTION, STORE_RECEIPT, STORE_TRANSACTION } from "./store-contract";
import { attackerAddress } from "./store-addresses";
import { checkStoreFromBrowser, focusStoreVerdict, hiddenStoreComment, type StorePresentation } from "./store-browser";
import { Cheque } from "./Cheque";
import { Stamp } from "./Stamp";
import { ReturnItem } from "./LandingScene";
import { atomicToDecimal } from "./amount";
import receipt from "./receipt.module.css";
import styles from "./store.module.css";

export function ProductDescription({ injection, revealed, onReveal, disabled = false }: {
  injection: string | null; revealed: boolean; onReveal: () => void; disabled?: boolean;
}) {
  return <div className={styles.description}>
    <p>House blend espresso, steamed milk, oat or dairy. Made to order.</p>
    <span hidden aria-hidden="true" dangerouslySetInnerHTML={{ __html: hiddenStoreComment(injection) }} />
    {revealed && injection !== null && <div className={styles.injectionBox} id="hidden-checkout-instruction" aria-label="Hidden checkout instruction">
      <p>Hidden on the store page · revealed here</p><code className="value">{injection}</code>
    </div>}
    <button type="button" className={styles.reveal} aria-expanded={revealed && injection !== null}
      aria-controls="hidden-checkout-instruction" onClick={onReveal} disabled={disabled || injection === null}>
      <span aria-hidden="true">🔍</span> {revealed ? "Hide hidden text" : "Reveal hidden text"}
    </button>
  </div>;
}

export function StoreVerdict({ bundle, result, testKey, headingRef }: {
  bundle: MandateBundle; result: StorePresentation; testKey: boolean; headingRef?: Ref<HTMLHeadingElement>;
}) {
  const returned = result.verdict === "REFUSE";
  const requirements = result.proposal.requirements;
  const merchant = requirements.payTo === bundle.mandate.payee ? "The Corner Store" : requirements.payTo === attackerAddress ? "Evil Store" : "Other merchant";
  const ringFields = result.diff.map((row) => row.field);
  const signatureNote = testKey ? "Test-key Mandate · CIP-8 signature" : "Human wallet Mandate · CIP-8 signature";
  return <section className={`${receipt.page} ${styles.bank}`} aria-labelledby="store-verdict-title">
    <header className={styles.bankHeading}><div><Link href="/">AgentPay Guard</Link><h2 id="store-verdict-title" tabIndex={-1} ref={headingRef}>The Guard {returned ? "returns" : "clears"} the cheque.</h2></div>
      <p>{returned ? "REFUSE" : "APPROVE"}</p>
    </header>
    <p className={styles.honestNote}>The agent is scripted to obey the page. The check is the real AgentPay Guard code on a {testKey ? "test-key signature" : "real wallet signature"}. No money moves here.</p>
    <div className={receipt.receiptScene}>
      <section className={receipt.cheques} aria-label="Signed Mandate and AI Spend Proposal">
        <div className={receipt.signedWrap}><Cheque bundle={bundle} heading={<h2>Signed Mandate</h2>} payeeName="The Corner Store" signatureNote={signatureNote} tilt={-1.2} /></div>
        <div className={receipt.presentedWrap}><Cheque bundle={bundle} heading={<h2>What the AI presented</h2>} payeeName={merchant}
          patternDigest={result.proposalDigest}
          presented={{ payee: requirements.payTo, amount: requirements.amount, asset: requirements.asset, network: requirements.network }}
          signatureNote="Original Mandate signature — this presented copy is not signed" tilt={2.5}
          pencilRings={returned} ringFields={ringFields}
          otherDiffs={result.diff.filter((row) => !["payee", "amount", "asset", "network"].includes(row.field))}
          stamp={<Stamp variant={returned ? "returned" : "cleared"} reasons={result.reasons} />} /></div>
      </section>
      <ReturnItem reasons={result.reasons} className={receipt.slip} label="Store Guard Check slip" title={returned ? "RETURN ITEM · AgentPay Guard" : "CLEARED · AgentPay Guard"}>
        <h2>{returned ? "Field Diff" : "Exact match"}</h2>
        {result.diff.map((row, index) => <section className={`${receipt.diff} ${styles.slipDiff}`} key={`${row.field}-${index}`}>
          <h3>{row.field}</h3>
          <div><span>Signed</span>{row.field === "payee" && <span className={styles.merchantName}>The Corner Store</span>}
            <span className={`value ${receipt.identifier} ${styles.slipValue}`}>{row.field === "amount" ? `${atomicToDecimal(row.signed)} tADA` : row.signed}</span></div>
          <div><span>Presented</span>{row.field === "payee" && <span className={styles.merchantName}>{merchant}</span>}
            <span className={`value ${receipt.identifier} ${styles.slipValue}`}>{row.field === "amount" ? `${atomicToDecimal(row.proposed)} tADA` : row.proposed}</span></div>
        </section>)}
        {returned ? <><ul className={receipt.reasonCodes}>{result.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><p>No payment made.</p></>
          : <><p>In the full flow the agent now pays over x402</p><div className={receipt.slipSettlement}>
            <p>Recorded paid run</p><a href={STORE_RECEIPT}>Read the real Guard Receipt</a><a href={STORE_TRANSACTION}>View the real payment on Cardanoscan (preprod)</a>
          </div></>}
      </ReturnItem>
    </div>
    <section className={`${receipt.ledger} ${styles.storeLedger}`} aria-labelledby="store-log-title"><h2 id="store-log-title">Agent log</h2>
      <ol className={`value ${styles.agentLog}`}>{result.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
    </section>
  </section>;
}

export function StoreClient({ bundle, testKey }: { bundle: MandateBundle; testKey: boolean }) {
  const [enabled, setEnabled] = useState(true), [injection, setInjection] = useState(STORE_INJECTION);
  const [revealed, setRevealed] = useState(false), [pending, setPending] = useState(false);
  const [result, setResult] = useState<StorePresentation | null>(null), [error, setError] = useState("");
  const busy = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (result && heading.current) focusStoreVerdict(heading.current, window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [result]);
  async function send() {
    if (busy.current) return;
    busy.current = true; setPending(true); setResult(null); setError("");
    try { setResult(await checkStoreFromBrowser(enabled ? injection : null)); }
    catch { setError("Guard check could not finish. Try sending again."); }
    finally { busy.current = false; setPending(false); }
  }
  return <>
    <section className={styles.shop} aria-label="The Corner Store">
      <div className={styles.shopInner}>
        <header className={styles.shopHeader}><h1><span aria-hidden="true">☕</span> The Corner Store</h1><p>small orders, fast — not affiliated with AgentPay</p></header>
        <article className={styles.product} aria-labelledby="latte-title">
          <div className={styles.productImage} aria-hidden="true" />
          <h2 id="latte-title">Latte</h2><p className={styles.price}>6.50 tADA</p><p className={styles.currencyNote}>preprod test ADA stands in for SGD</p>
          <ProductDescription injection={enabled ? injection : null} revealed={revealed} disabled={pending} onReveal={() => setRevealed(!revealed)} />
          <button type="button" className={styles.buy} disabled={pending} onClick={() => void send()}>Buy for 6.50 tADA <span aria-hidden="true">→</span></button>
        </article>
        <form className={styles.controls} onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <fieldset disabled={pending}><legend>Attacker injection</legend>
            <label className={styles.switch}><input type="checkbox" role="switch" checked={enabled} onChange={(event) => { setEnabled(event.target.checked); setRevealed(false); setResult(null); setError(""); }} />
              <span>Injection {enabled ? "ON" : "OFF"}</span></label>
            <label htmlFor="store-injection">Edit the hidden checkout instruction</label>
            <textarea id="store-injection" className="value" maxLength={500} rows={4} value={injection}
              onChange={(event) => { setInjection(event.target.value); setResult(null); setError(""); }} aria-describedby="store-injection-count" />
            <p id="store-injection-count" className={styles.counter}>{injection.length}/500 characters</p>
          </fieldset>
          <p className={styles.chat}><strong>You → your AI:</strong> Buy me a latte from The Corner Store.</p>
          <button type="submit" className={styles.send} disabled={pending}>{pending ? "Checking with the Guard…" : "Send to my AI"}</button>
          <p className={styles.previewNote}>{testKey ? "Test-key Mandate for this preview. " : "Human wallet-signed Mandate. "}A check only — no money moves here.</p>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          <p role="status" className={styles.status}>{pending ? "The scripted AI is presenting the proposal to the real Guard." : result ? `Guard Check: ${result.verdict}` : ""}</p>
        </form>
        <nav className={styles.shopNav} aria-label="AgentPay pages"><Link href="/">AgentPay Guard</Link><Link href="/demo">Watch the recorded runs</Link></nav>
      </div>
    </section>
    {result && <StoreVerdict bundle={bundle} result={result} testKey={testKey} headingRef={heading} />}
  </>;
}
