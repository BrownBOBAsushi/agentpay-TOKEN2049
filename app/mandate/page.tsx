"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Cheque } from "../../src/web/Cheque";
import { Stamp } from "../../src/web/Stamp";
import { CopySignature } from "../../src/web/CopySignature";
import { mandateDigest } from "../../src/guard/digest";
import type { MandateBundle } from "../../src/guard/bundle";
import { groupAtomic } from "../../src/web/amount";
import { connectWallet, installedWallets, newNonce, signMandate, validateDraft, NO_WALLET,
  type ConnectedWallet, type Draft, type FieldErrors, type WalletName, type WalletWindow } from "../../src/web/mandate-wallet";
import styles from "./mandate.module.css";

const emptyDraft: Draft = { payee: "", amount: "", asset: "tADA", purpose: "", expiry: "", nonce: "" };
const tusdmUnit = process.env.NEXT_PUBLIC_TUSDM_UNIT;
function FieldError({ field, errors }: { field: keyof FieldErrors; errors: FieldErrors }) {
  return <span id={`${field}-error`} className={styles.error}>{errors[field]}</span>;
}

export default function MandatePage() {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [providers, setProviders] = useState<WalletName[]>([]);
  const [selected, setSelected] = useState<WalletName | "">("");
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [bundle, setBundle] = useState<MandateBundle | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [pattern, setPattern] = useState<string | null>(null);
  const validation = useMemo(() => validateDraft(draft, wallet?.payer ?? "", tusdmUnit), [draft, wallet]);

  function refreshWallets() {
    const installed = installedWallets(window as WalletWindow);
    setProviders(installed); setSelected(installed[0] ?? ""); setWallet(null); setBundle(null); setCopyStatus(""); setMessage(""); setReady(true);
  }
  useEffect(() => {
    // Browser extension discovery and randomness run after hydration, never on the server.
    const timer = setTimeout(() => { refreshWallets(); setDraft((value) => ({ ...value, nonce: newNonce() })); }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setPattern(validation.mandate ? mandateDigest(validation.mandate) : null), 150);
    return () => clearTimeout(timer);
  }, [validation]);

  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value })); setBundle(null); setCopyStatus(""); setMessage("");
  }
  async function connect() {
    if (!selected) return;
    setBusy(true); setMessage("Connecting wallet…"); setBundle(null); setWallet(null); setCopyStatus("");
    try { setWallet(await connectWallet(window as WalletWindow, selected)); setMessage("Wallet connected. Review your Mandate before signing."); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function sign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet || !validation.mandate) { setMessage("Check the fields marked below before signing."); return; }
    setBusy(true); setMessage("Review the signing request in your wallet."); setBundle(null); setCopyStatus("");
    try {
      const signed = await signMandate(wallet, validation.mandate);
      setBundle(signed); setPattern(signed.digest); setMessage("Mandate signed. Signature verified in this browser.");
    }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function copy() {
    if (!bundle) return;
    try { await navigator.clipboard.writeText(JSON.stringify(bundle, null, 2)); setCopyStatus("Copied"); }
    catch { setCopyStatus("Copy unavailable. Download bundle.json instead."); }
  }
  function download() {
    if (!bundle) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "bundle.json";
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const errors = validation.errors;
  const onlyPayerMissing = !wallet && Object.keys(errors).length === 1 && !!errors.payer;
  return <main className={styles.page}>
    <Link href="/">AgentPay Guard</Link>
    <p className={styles.intro}>Cardano preprod · test funds only. Set your wallet to preprod. The wallet network ID identifies testnet, but cannot distinguish preprod from preview.</p>
    <form onSubmit={sign} noValidate>
      <fieldset disabled={busy} className={styles.form}>
        <legend className="sr-only">Write and sign a Mandate</legend>
        <section className={styles.wallet} aria-labelledby="wallet-heading">
          <h2 id="wallet-heading">Wallet</h2>
          {!ready ? <p>Checking installed wallets…</p> : providers.length === 0 ? <p>{NO_WALLET}</p> : <>
            <label htmlFor="wallet-provider">Installed wallet</label>
            <select id="wallet-provider" value={selected} onChange={(event) => { setSelected(event.target.value as WalletName); setWallet(null); setBundle(null); setCopyStatus(""); setMessage(""); }}>
              {providers.map((name) => <option value={name} key={name}>{name === "lace" ? "Lace" : "Eternl"}</option>)}
            </select>
            <button type="button" onClick={connect}>Connect wallet</button>
          </>}
          <button type="button" onClick={refreshWallets}>Refresh installed wallets</button>
          <p>Payer: <span className="value">{wallet?.payer ?? "No wallet connected"}</span></p>
          <FieldError field="payer" errors={errors} />
        </section>
        <Cheque heading={<h1>Sign a Mandate</h1>} patternDigest={validation.mandate ? pattern : null} edit={<>
          <div className="cheque-fields">
            <div className="payee-line ruled-field">
              <label className="field-label" htmlFor="payee">Pay to the order of</label>
              <input className="value" id="payee" value={draft.payee} onChange={(event) => change("payee", event.target.value)} required aria-invalid={!!errors.payee} aria-describedby="payee-error" />
              <FieldError field="payee" errors={errors} />
            </div>
            <div className="amount-box">
              <label className="field-label" htmlFor="amount">Amount</label>
              <input className="value" id="amount" type="number" inputMode="decimal" min="0.000001" step="0.000001" value={draft.amount} onChange={(event) => change("amount", event.target.value)} required aria-invalid={!!errors.amount} aria-describedby="amount-hint amount-error" />
              <p id="amount-hint">In tADA or tUSDM, up to 6 decimals.</p>
              <FieldError field="amount" errors={errors} />
              <label className="field-label" htmlFor="asset">Asset</label>
              <select className="value" id="asset" value={draft.asset} onChange={(event) => change("asset", event.target.value as Draft["asset"])} aria-invalid={!!errors.asset} aria-describedby="asset-error">
                <option value="tADA">tADA</option><option value="tUSDM">tUSDM</option>
              </select>
              <FieldError field="asset" errors={errors} />
              {validation.mandate && <p className="value asset">{groupAtomic(validation.mandate.amount)} {validation.mandate.asset}</p>}
            </div>
            <div className="memo-line ruled-field">
              <label className="field-label" htmlFor="purpose">Memo</label>
              <textarea className="value" id="purpose" rows={3} maxLength={280} value={draft.purpose} onChange={(event) => change("purpose", event.target.value)} required aria-invalid={!!errors.purpose} aria-describedby="purpose-error" />
              <FieldError field="purpose" errors={errors} />
            </div>
            <div className="expiry-line ruled-field">
              <label className="field-label" htmlFor="expiry">Void after (UTC)</label>
              <input className="value" id="expiry" type="datetime-local" step="60" value={draft.expiry} onChange={(event) => change("expiry", event.target.value)} required aria-invalid={!!errors.expiry} aria-describedby="expiry-error expiry-help" />
              <p id="expiry-help">Enter UTC, not your local time.</p><FieldError field="expiry" errors={errors} />
            </div>
            <div className="signature-block">
              <p className="field-label">CIP-8 signature</p>
              {bundle ? <><span className="value signature-short" title={bundle.coseSign1}>{bundle.coseSign1.slice(0, 26)}…{bundle.coseSign1.slice(-26)}</span><CopySignature signature={bundle.coseSign1} /></>
                : <p>Not signed</p>}
            </div>
            {bundle && <div className="stamp-placement"><Stamp variant="signed" /></div>}
          </div>
          <div className={styles.nonce}>
            <label className="field-label" htmlFor="nonce">Nonce</label>
            <input className="value" id="nonce" readOnly value={draft.nonce} aria-describedby="nonce-error" />
            <button type="button" onClick={() => change("nonce", newNonce())}>New nonce</button><FieldError field="nonce" errors={errors} />
          </div>
          <div className="micr-line">{validation.mandate && pattern ? <><span>Mandate digest:</span><span className="value">{pattern}</span></>
            : <span>{onlyPayerMissing ? "Connect a wallet to draw the safety pattern — your address is part of the Mandate." : "Complete valid fields to draw the safety pattern."}</span>}</div>
          <div className={styles.actions}>
            <button type="submit" disabled={!validation.mandate || !wallet}>Sign Mandate</button>
            {bundle && <><button type="button" onClick={copy}>Copy bundle</button><button type="button" onClick={download}>Download bundle.json</button></>}
          </div>
        </>} />
      </fieldset>
    </form>
    <p role="status" className={styles.status}>{message}</p><p role="status">{copyStatus}</p>
    <p>This page sends no Mandate or bundle to a server. No keys or seed phrases are requested or stored. Editing a field removes the signed result.</p>
  </main>;
}
