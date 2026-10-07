import type { CSSProperties, ReactNode } from "react";
import type { Mandate } from "../guard/mandate";
import { atomicToDecimal } from "./amount";
import { Stamp } from "./Stamp";

export function PaperObject({ children, mandate, tilt, signed = false, stub }: { children: ReactNode; mandate?: Mandate; tilt: number; signed?: boolean; stub?: ReactNode }) {
  return <div className="paper-object" style={{ "--paper-tilt": `${tilt}deg` } as CSSProperties}>
    <aside className="cheque-stub" aria-label="Cheque-book stub">
      {stub ?? <><span className="value">{mandate ? new Date(mandate.expiry * 1000).toISOString().slice(0, 10) : "Date —"}</span>
      <span>To <span className="value">{mandate ? `${mandate.payee.slice(0, 12)}…${mandate.payee.slice(-6)}` : "Payee —"}</span></span>
      <span className="value">{mandate ? mandate.asset === "lovelace" ? `${atomicToDecimal(mandate.amount)} tADA` : mandate.amount : "Amount —"}</span>
      <span className="value">{mandate ? mandate.nonce.slice(0, 8) : "Nonce —"}</span>
      {signed && <span className="stub-signed" aria-label="SIGNED on cheque stub"><Stamp variant="signed" /></span>}</>}
    </aside><div className="paper-body">{children}</div>
  </div>;
}
