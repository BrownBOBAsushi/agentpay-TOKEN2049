import type { ReactNode } from "react";
import type { MandateBundle } from "../guard/bundle";
import { guillochePaths } from "./guilloche";
import { CopySignature } from "./CopySignature";

function MicrSeparator() {
  return <svg className="micr-separator" viewBox="0 0 20 24" aria-hidden="true"><path d="M3 3v18M9 6h8M9 12h8M9 18h8" /></svg>;
}
function FieldValue({ signed, proposed }: { signed: string; proposed?: string }) {
  return proposed && proposed !== signed ? <span className="field-diff">
    <span><span className="sr-only">Presented: </span><del className="value">{proposed}</del></span>
    <span><span className="sr-only">Signed: </span><ins className="value">{signed}</ins></span>
  </span> : <span className="value">{signed}</span>;
}

export function Cheque({ bundle, heading, presented, patternDigest = bundle.digest, stamp, actions }: {
  bundle: MandateBundle; heading: ReactNode; presented?: { payee: string; amount: string };
  patternDigest?: string; stamp?: ReactNode; actions?: ReactNode;
}) {
  const m = bundle.mandate;
  const expiry = new Date(m.expiry * 1000).toISOString();
  const signature = bundle.coseSign1;
  return <article className={`cheque${presented ? " cheque-presented" : ""}`}>
    <svg className="guilloche-field" viewBox="0 0 600 600" aria-hidden="true">
      {guillochePaths(patternDigest).map((path, i) => <path key={i} d={path} />)}
    </svg>
    <div className="cheque-content">
      <div className="printed-legend"><span>AgentPay Guard</span><span className="value">{m.network}</span></div>
      {heading}
      <div className="cheque-fields">
        <div className="payee-line ruled-field"><span className="field-label">Pay to the order of</span><FieldValue signed={m.payee} proposed={presented?.payee} /></div>
        <div className="amount-box"><span className="field-label">Amount</span><FieldValue signed={m.amount} proposed={presented?.amount} /><span className="value asset">{m.asset}</span></div>
        <div className="memo-line ruled-field"><span className="field-label">Memo</span><span className="value">{m.purpose}</span></div>
        <div className="expiry-line ruled-field"><span className="field-label">Void after</span><time className="value" dateTime={expiry}>{expiry.slice(0, 10)} · 00:00 UTC</time></div>
      </div>
      <div className="signature-row">
        <div className="signature-block">
          <div className="ruled-field signature-line"><span className="field-label">CIP-8 signature</span><span className="value signature-short" title={signature}>{signature.slice(0, 26)}…{signature.slice(-26)}</span></div>
          <p className="test-key-note">Signed with a test key on Cardano preprod</p>
          <CopySignature signature={signature} />
        </div>
        {stamp && <div className="stamp-placement">{stamp}</div>}
        {actions && <nav className="cheque-actions" aria-label="Get started">{actions}</nav>}
      </div>
      <div className="micr-line value"><MicrSeparator /><span>{m.nonce}</span><MicrSeparator /><span title={patternDigest}>{patternDigest.slice(0, 8)}…{patternDigest.slice(-8)}</span><MicrSeparator /><span>{presented?.amount ?? m.amount}</span><MicrSeparator /></div>
    </div>
  </article>;
}
