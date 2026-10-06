import Link from "next/link";
import { Cheque } from "./Cheque";
import { Stamp } from "./Stamp";
import { CopyValue } from "./CopyValue";
import type { ReceiptPageData } from "./receipt-types";
import styles from "./receipt.module.css";

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
  return <main className={styles.page}>
    <Link href="/">AgentPay Guard</Link>
    <header className={styles.header}>
      <div><h1>Guard Receipt</h1><p>Task <span className="value">{data.taskId}</span></p>
        {time ? <time className="value" dateTime={time}>{time.replace("T", " ").replace(".000Z", " UTC")}</time> : <p>Time unavailable</p>}
      </div>
      <Stamp variant={data.verdict === "REFUSE" ? "returned" : "cleared"} reasons={data.reasons} />
    </header>
    {data.example ? <p>Illustrative example — signature, complete inputs and settlement evidence are unavailable.</p>
      : <p className={data.signatureValid ? undefined : styles.invalid}>{data.signatureValid
        ? <>Guard signature valid — signed by <span className="value">{data.guardAddress}</span></>
        : "Signature INVALID"}</p>}
    <section aria-labelledby="receipt-diff"><h2 id="receipt-diff">Field Diff</h2>
      {data.diff.length === 0 && <p>No differing fields in this Guard Receipt.</p>}
      {data.diff.map((entry, index) => <div className={styles.diff} key={`${entry.field}-${index}`}>
        <h3>{entry.field}</h3><div><span className="field-label">Signed</span><span className="value">{entry.signed}</span></div>
        <div><span className={styles.invalid}>MUST NOT</span><span className="field-label">Presented</span><del className="value">{entry.proposed}</del></div>
      </div>)}
      <dl className={styles.matching}>{data.matching.map((entry) => <div key={entry.field}><dt>{entry.field} · matches</dt><dd className="value">{entry.signed}</dd></div>)}</dl>
    </section>
    {data.bundle && data.proposal ? <section className={styles.cheques} aria-label="Mandate and Spend Proposal">
      <Cheque bundle={data.bundle} heading={<h2>Signed Mandate</h2>} patternDigest={data.digests.mandate!} signatureNote="Mandate CIP-8 signature" />
      <Cheque bundle={data.bundle} heading={<h2>Presented copy</h2>} patternDigest={data.digests.proposal!}
        presented={{ payee: data.proposal.requirements.payTo, amount: data.proposal.requirements.amount,
          asset: data.proposal.requirements.asset, network: data.proposal.requirements.network }}
        signatureNote="Original Mandate signature — the presented copy is not signed" />
    </section> : <p>{data.inputs === "digest-mismatch" ? "Task inputs do not match the receipt digests. Cheques are unavailable." : "Complete Mandate and Spend Proposal unavailable."}</p>}
    <section className={styles.anchor} aria-labelledby="anchor"><h2 id="anchor">On-chain anchor</h2>
      {data.anchor.kind === "free" ? <p>Free rehearsal — no payment</p> : data.anchor.kind === "example" ? <p>Settlement evidence unavailable for this example.</p>
        : <><p>{data.anchor.settled ? "Settled" : "Not settled"} · <span className="value">{data.anchor.onChainState ?? "State unavailable"}</span></p>
          {data.anchor.txHash && <a href={`https://preprod.cardanoscan.io/transaction/${data.anchor.txHash}`}>View transaction on Cardanoscan preprod <span className="value">{data.anchor.txHash}</span></a>}</>}
    </section>
    <section className={styles.digests} aria-label="Receipt digests">{Object.entries(data.digests).map(([name, value]) => <div key={name}>
      <h2>{name}Digest</h2>{!value || /^0{64}$/.test(value) ? <p>unavailable</p> : <CopyValue label={`${name}Digest`} value={value} />}
    </div>)}</section>
  </main>;
}
