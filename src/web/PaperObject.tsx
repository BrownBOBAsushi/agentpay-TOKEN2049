import type { CSSProperties, ReactNode } from "react";
import type { Mandate } from "../guard/mandate";
import { atomicToDecimal } from "./amount";

export function PaperObject({ children, mandate, tilt }: { children: ReactNode; mandate: Mandate; tilt: number }) {
  return <div className="paper-object" style={{ "--paper-tilt": `${tilt}deg` } as CSSProperties}>
    <aside className="cheque-stub" aria-label="Cheque-book stub">
      <span className="value">{new Date(mandate.expiry * 1000).toISOString().slice(0, 10)}</span>
      <span>To <span className="value">{mandate.payee.slice(0, 12)}…{mandate.payee.slice(-6)}</span></span>
      <span className="value">{mandate.asset === "lovelace" ? `${atomicToDecimal(mandate.amount)} tADA` : mandate.amount}</span>
      <span className="value">{mandate.nonce.slice(0, 8)}</span>
    </aside><div className="paper-body">{children}</div>
  </div>;
}
