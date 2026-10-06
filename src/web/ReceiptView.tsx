import Link from "next/link";
import { Cheque } from "./Cheque";
import { Stamp } from "./Stamp";
import { CopyValue } from "./CopyValue";
import { ReturnItem } from "./LandingScene";
import { atomicToDecimal, groupAtomic } from "./amount";
import type { ReceiptPageData, ReceiptRecord } from "./receipt-types";
import styles from "./receipt.module.css";

function DiffValue({ value, asset, struck = false }: { value: string; asset?: string; struck?: boolean }) {
  const isAmount = asset && /^\d+$/.test(value);
  const main = isAmount && asset === "lovelace" ? `${atomicToDecimal(value)} tADA` : value;
  return <>
    {struck ? <del className="value">{main}</del> : <span className="value">{main}</span>}
    {isAmount && <small className={`value ${styles.atomic}`}>{groupAtomic(value)} {asset}</small>}
  </>;
}

const digestLabels = { receipt: "Receipt digest", mandate: "Mandate digest", proposal: "Proposal digest" };

function CheckedMark() {
  return <svg className={styles.checkedMark} viewBox="0 0 20 20" aria-hidden="true"><path d="m3 10 4.5 4.5L17 5" /></svg>;
}

function VoidMark() {
  return <div className={styles.voidMark} role="img" aria-label="VOID"><svg viewBox="0 0 320 100" aria-hidden="true"><path d="M5 5H315V95H5ZM12 12H308V88H12Z" fill="none" stroke="currentColor" /><text x="160" y="72" textAnchor="middle">VOID</text></svg></div>;
}

function settlementLabel(data: ReceiptRecord) {
  if (!data.receiptValid) return "VOID — settlement is not asserted";
  if (data.anchor.kind === "free") return "CLEARED — free rehearsal, no payment";
  if (data.anchor.kind === "example") return "CLEARED — example; settlement evidence unavailable";
  if (data.anchor.settled) return "PAID — CLEARED · settled";
  return `CLEARED — not settled · ${data.anchor.onChainState ?? "state unavailable"}`;
}

function SlipSettlement({ data }: { data: ReceiptRecord }) {
  if (data.verdict !== "APPROVE" || !data.receiptValid) return null;
  return <div className={styles.slipSettlement}>
    <p>{settlementLabel(data)}</p>
      {data.anchor.kind === "paid" && <>
        <p>Settlement state: <span className="value">{data.anchor.onChainState ?? "State unavailable"}</span></p>
      {data.anchor.txHash && <><a href={`https://preprod.cardanoscan.io/transaction/${data.anchor.txHash}`}>Cardanoscan preprod transaction</a><CopyValue label="Transaction ID" value={data.anchor.txHash} /></>}
    </>}
  </div>;
}

function DiffRows({ data }: { data: ReceiptRecord }) {
  return <>
    {data.diff.length === 0 && <p>No differing fields in this Guard Receipt.</p>}
    {data.diff.map((entry, index) => <div className={styles.diff} key={`${entry.field}-${index}`}>
      <h3>{entry.field}</h3><div><span className="field-label">Signed</span><DiffValue value={entry.signed} asset={entry.field === "amount" ? data.bundle?.mandate.asset : undefined} /></div>
      <div><span className={styles.invalid}>MUST NOT</span><span className="field-label">Presented</span><DiffValue value={entry.proposed} asset={entry.field === "amount" ? data.proposal?.requirements.asset : undefined} struck /></div>
    </div>)}
  </>;
}

export function ReceiptView({ data }: { data: ReceiptPageData }) {
  if (data.kind !== "receipt") {
    const title = data.kind === "not-found" ? "No Guard Receipt for this Task"
      : data.kind === "in-progress" ? "Guard Check in progress"
      : data.kind === "not-receipt" ? "This Task's result is not a Guard Receipt" : "Core is unreachable";
    return <main className={styles.page}><Link href="/">AgentPay Guard</Link><h1>{title}</h1>
      {data.kind === "in-progress" && <p>Current status: <span className="value">{data.status}</span></p>}
      {data.kind === "unreachable" && <p>The Guard Receipt cannot be loaded. Try again later.</p>}
      <Link href="/">Return home</Link></main>;
  }
  const time = data.ts === null ? null : new Date(data.ts * 1000).toISOString();
  const stamp = data.receiptValid ? <Stamp variant={data.verdict === "REFUSE" ? "returned" : "cleared"} reasons={data.reasons} /> : null;
  const ringFields = data.diff.map((entry) => entry.field);
  const extraDiffs = data.diff.filter((entry) => !["payee", "amount", "network"].includes(entry.field));
  const displayedVerdict = data.receiptValid ? data.verdict : "VOID";
  const hasCheques = !!(data.bundle && data.proposal);
  return <main className={styles.page}>
    <Link href="/">AgentPay Guard</Link>
    <header className={styles.header}>
      <div><h1 className={styles.legend}>Guard Receipt</h1><p>Task <span className="value">{data.taskId}</span></p>
        {time ? <time className="value" dateTime={time}>{time.replace("T", " ").replace(".000Z", " UTC")}</time> : <p>Time unavailable</p>}
      </div>
      <div className={styles.verdict} aria-label={`Verdict ${displayedVerdict}`}>{displayedVerdict}</div>
    </header>
    <ul className={styles.facts} aria-label="Guard Receipt checks">
      <li>{data.example ? "Guard signature unavailable for this example" : data.signatureValid
        ? <>Guard signature valid — <span className="value">{data.guardAddress}</span></> : "Guard signature INVALID"}</li>
      <li>{data.inputsBound ? data.inputs === "unavailable" ? "Receipt matches this Task's unavailable inputs (REFUSE exception)" : "Receipt matches Task inputs" : "Receipt does NOT match this Task"}</li>
      <li>Verdict {displayedVerdict}</li>
    </ul>
    {!data.sentinelOk && <p className={styles.reasonLine}>Zero-digest rule INVALID — APPROVE cannot use unavailable digests.</p>}

    <div className={styles.receiptScene}>
      <ReturnItem reasons={data.reasons} title={data.receiptValid && data.verdict === "REFUSE" ? "RETURN ITEM · AgentPay Guard · Guard Check" : "GUARD CHECK RECORD"}
        label={data.receiptValid && data.verdict === "REFUSE" ? "Return Item slip" : "Guard Check slip"} className={styles.slip}>
        <section aria-labelledby="receipt-diff">
          {!hasCheques && data.receiptValid && <Stamp variant={data.verdict === "REFUSE" ? "returned" : "cleared"} reasons={data.reasons} />}
          <h2 id="receipt-diff">Field Diff</h2>
          <DiffRows data={data} />
          {data.receiptValid && data.verdict === "REFUSE" && <><h3>Recorded reasons</h3><ul className={styles.reasonCodes}>{data.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></>}
          {!data.receiptValid && <><VoidMark /><p>VOID — not a valid Guard Receipt for this Task</p><h3>Failing facts</h3><ul className={styles.reasonCodes}>{data.invalidReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><p>Settlement is not asserted for a VOID receipt.</p></>}
          {data.reasons.length > 0 && !(data.receiptValid && data.verdict === "REFUSE") && <><h3>Recorded reason codes</h3><ul className={styles.reasonCodes}>{data.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></>}
          {data.example && <p>Illustrative example — signature, complete inputs and settlement evidence are unavailable.</p>}
          <p>{data.sentinelOk ? "Zero-digest rule valid" : "Zero-digest rule INVALID — APPROVE cannot use unavailable digests"}</p>
          <div className={styles.checked} aria-label="Checked fields"><h3>Checked</h3>
            {data.matching.length === 0 ? <p>No matching fields are available.</p> : <ul>{data.matching.map((entry) => <li key={entry.field}><CheckedMark /><span>{entry.field} · matches</span><DiffValue value={entry.signed} asset={entry.field === "amount" ? data.bundle?.mandate.asset : undefined} /></li>)}</ul>}
          </div>
          <SlipSettlement data={data} />
        </section>
      </ReturnItem>
      {data.bundle && data.proposal ? <section className={styles.cheques} aria-label="Mandate and Spend Proposal">
        <div className={styles.signedWrap}><Cheque bundle={data.bundle} heading={<h2>Signed Mandate</h2>} patternDigest={data.digests.mandate ?? undefined} signatureNote="Mandate CIP-8 signature" tilt={-1.2} /></div>
        <div className={styles.presentedWrap}>
          <Cheque bundle={data.bundle} heading={<h2>Presented copy</h2>} patternDigest={data.digests.proposal ?? undefined}
            presented={{ payee: data.proposal.requirements.payTo, amount: data.proposal.requirements.amount,
              asset: data.proposal.requirements.asset, network: data.proposal.requirements.network }}
            signatureNote="Original Mandate signature — the presented copy is not signed" tilt={2.5}
            pencilRings={data.receiptValid && data.verdict === "REFUSE"} ringFields={ringFields} otherDiffs={extraDiffs}
            stamp={stamp} />
        </div>
      </section> : <p className={styles.inputsUnavailable}>{data.inputs === "digest-mismatch"
        ? "Task inputs do not match the receipt digests. Cheques are unavailable." : "Complete Mandate and Spend Proposal unavailable."}</p>}
    </div>

    <section className={styles.ledger} aria-label="Ledger index card">
      <h2>Ledger index</h2>
      <div className={styles.settlementSlip}>
        <p>{!data.receiptValid ? "VOID — settlement is not asserted" : data.verdict === "REFUSE" ? "RETURNED — payment decision refused" : settlementLabel(data)}</p>
        {!data.receiptValid ? <p>Settlement is not asserted for a VOID receipt.</p>
          : data.anchor.kind === "free" ? <p>Free rehearsal — no payment</p>
          : data.anchor.kind === "example" ? <p>Settlement evidence unavailable for this example.</p>
          : <><p>Settlement state: <span className="value">{data.anchor.onChainState ?? "State unavailable"}</span></p>
            {data.anchor.txHash && <><a href={`https://preprod.cardanoscan.io/transaction/${data.anchor.txHash}`}>View transaction on Cardanoscan preprod <span className="value">{data.anchor.txHash}</span></a><CopyValue label="Transaction ID" value={data.anchor.txHash} /></>}</>}
      </div>
      <div className={styles.digests} aria-label="Receipt digests">{Object.entries(data.digests).map(([name, value]) => <div key={name}>
        <h3>{digestLabels[name as keyof typeof digestLabels]}</h3>{!value || /^0{64}$/.test(value) ? <p>unavailable</p> : <CopyValue label={digestLabels[name as keyof typeof digestLabels]} value={value} />}
      </div>)}</div>
    </section>
  </main>;
}
