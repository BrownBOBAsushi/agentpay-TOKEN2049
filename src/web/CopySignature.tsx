"use client";

import { useState } from "react";

export function CopySignature({ signature }: { signature: string }) {
  const [message, setMessage] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(signature); setMessage("Signature copied."); }
    catch { setMessage("Copy unavailable. Open the full signature to select and copy it."); }
  }
  return <div className="signature-tools">
    <button type="button" className="copy-button" title={signature} onClick={copy}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h12v13H8zM4 16H2V2h13v2" /></svg>
      Copy signature
    </button>
    <span className="copy-status" role="status">{message}</span>
    <details><summary>View full signature</summary><code className="full-signature value">{signature}</code></details>
  </div>;
}
