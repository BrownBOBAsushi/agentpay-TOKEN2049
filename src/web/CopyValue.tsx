"use client";

import { useState } from "react";

export function CopyValue({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState("");
  return <div>
    <code className="value" title={value}>{value}</code>
    <button type="button" className="copy-button" aria-label={`Copy ${label}`} onClick={async () => {
      try { await navigator.clipboard.writeText(value); setStatus(`${label} copied.`); }
      catch { setStatus("Copy unavailable. Select and copy the value above."); }
    }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h12v13H8zM4 16H2V2h13v2" /></svg>Copy</button>
    <span role="status">{status}</span>
  </div>;
}
