import type { ReactNode } from "react";
import type { MandateBundle } from "../guard/bundle";
import { EngravedSeal, SecurityPaper } from "./SecurityPaper";
import { PaperObject } from "./PaperObject";
import { PencilRing } from "./LandingScene";
import { CopySignature } from "./CopySignature";
import { atomicToDecimal, groupAtomic } from "./amount";

function MicrSeparator() {
  return <svg className="micr-separator" viewBox="0 0 20 24" aria-hidden="true"><path d="M3 3v18M9 6h8M9 12h8M9 18h8" /></svg>;
}
function FieldValue({ signed, proposed, detail, pencilRings = false }: { signed: string; proposed?: string; detail?: string; pencilRings?: boolean }) {
  return proposed && proposed !== signed ? <span className="field-diff">
    <span className="change-mark">MUST NOT</span>
    <span className={pencilRings ? "presented-value ring-target" : "presented-value"}>
      <del className="value">{proposed}</del>
      {pencilRings && <PencilRing />}
    </span>
    {detail && <span className="value asset">{detail}</span>}
    <span className="signed-annotation">signed: <span className="value">{signed}</span></span>
  </span> : <><span className="value">{signed}</span>{detail && <span className="value asset">{detail}</span>}</>;
}

type ReadChequeProps = {
  bundle: MandateBundle; heading: ReactNode; presented?: { payee: string; amount: string; asset?: string; network?: string };
  patternDigest?: string; stamp?: ReactNode; actions?: ReactNode; signatureNote?: string; tilt?: number; pencilRings?: boolean;
  ringFields?: string[]; otherDiffs?: { field: string; signed: string; proposed: string }[];
};
type EditChequeProps = { edit: ReactNode; heading: ReactNode; patternDigest: string | null; stubMandate?: MandateBundle["mandate"]; signed?: boolean };

export function Cheque(props: ReadChequeProps | EditChequeProps) {
  if ("edit" in props) return <PaperObject mandate={props.stubMandate} tilt={-1.2} signed={props.signed}><article className="cheque">
    <SecurityPaper digest={props.patternDigest} />
    <div className="cheque-content">
      <div className="printed-legend"><span className="legend-brand"><EngravedSeal />AgentPay Guard</span><span className="value">cardano:preprod</span></div>
      {props.heading}{props.edit}
    </div>
  </article></PaperObject>;
  const { bundle, heading, presented, patternDigest = bundle.digest, stamp, actions, signatureNote = "Signed with a test key on Cardano preprod" } = props;
  const m = bundle.mandate;
  const expiryDate = new Date(m.expiry * 1000);
  const expiry = Number.isNaN(expiryDate.getTime()) ? null : expiryDate.toISOString();
  const signature = bundle.coseSign1;
  const humanAmount = (amount: string, asset = m.asset) => asset === "lovelace" ? `${atomicToDecimal(amount)} tADA` : amount;
  const cheque = <article className={`cheque${presented ? " cheque-presented" : ""}`}>
    <SecurityPaper digest={patternDigest} presented={!!presented} />
    <div className="cheque-content">
      <div className="printed-legend"><span className="legend-brand"><EngravedSeal />AgentPay Guard</span><span className={props.pencilRings && props.ringFields?.includes("network") ? "ring-target" : undefined}><span className="value">{presented?.network ?? m.network}</span>{props.pencilRings && props.ringFields?.includes("network") && <PencilRing />}</span></div>
      {heading}
      <div className="cheque-fields">
        <div className="payee-line ruled-field"><span className="field-label">Pay to the order of</span><FieldValue signed={m.payee} proposed={presented?.payee} pencilRings={props.pencilRings && (props.ringFields?.includes("payee") ?? true)} /></div>
        <div className="amount-box"><span className="field-label">Amount</span><FieldValue signed={humanAmount(m.amount)} proposed={presented ? humanAmount(presented.amount, presented.asset) : undefined} detail={`${groupAtomic(presented?.amount ?? m.amount)} ${presented?.asset ?? m.asset}`} pencilRings={props.pencilRings && (!props.ringFields || props.ringFields.includes("amount"))} /></div>
        {stamp && <div className="stamp-placement">{stamp}</div>}
        <div className="memo-line ruled-field"><span className="field-label">Memo</span><span className="value">{m.purpose}</span></div>
        <div className="expiry-line ruled-field"><span className="field-label">Void after</span>{expiry ? <time className="value" dateTime={expiry}>{expiry.slice(0, 10)} · {expiry.slice(11, 19)} UTC</time> : <span className="value">{m.expiry} Unix seconds</span>}</div>
        <div className="signature-block">
          <div className="ruled-field signature-line"><span className="field-label">CIP-8 signature</span><span className="value signature-short" title={signature}>{signature.slice(0, 26)}…{signature.slice(-26)}</span></div>
          <p className="test-key-note">{signatureNote}</p>
          {!presented && <CopySignature signature={signature} />}
        </div>
        {props.pencilRings && props.otherDiffs && props.otherDiffs.length > 0 && <dl className="presented-other-diffs">{props.otherDiffs.map((entry, index) => <div key={`${entry.field}-${index}`}>
          <dt>{entry.field}</dt><dd><span className="ring-target"><del className="value">{entry.proposed}</del><PencilRing /></span><span className="signed-annotation">signed: <span className="value">{entry.signed}</span></span></dd>
        </div>)}</dl>}
        {actions && <nav className="cheque-actions" aria-label="Get started">{actions}</nav>}
      </div>
      <div className="micr-line value"><MicrSeparator /><span>{m.nonce}</span><MicrSeparator /><span title={patternDigest}>{patternDigest.slice(0, 8)}…{patternDigest.slice(-8)}</span><MicrSeparator /><span>{presented?.amount ?? m.amount}</span><MicrSeparator /></div>
    </div>
  </article>;
  return props.tilt === undefined ? cheque : <PaperObject mandate={presented ? { ...m, payee: presented.payee, amount: presented.amount } : m} tilt={props.tilt}>{cheque}</PaperObject>;
}
