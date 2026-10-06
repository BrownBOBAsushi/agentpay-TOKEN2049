import { Address, CBOR } from "@evolution-sdk/evolution";
import { parseMandate, MandateParseError, type Mandate } from "../guard/mandate";
import { mandateDigest } from "../guard/digest";
import { jcs } from "../guard/jcs";
import { verifyMandate } from "../guard/cip8";
import type { MandateBundle } from "../guard/bundle";
import { decimalToAtomic } from "./amount";

export type WalletApi = {
  getNetworkId(): Promise<number>; getUsedAddresses(): Promise<string[]>; getChangeAddress(): Promise<string>;
  signData(address: string, payload: string): Promise<{ signature: string; key: string }>;
};
export type Provider = { enable(): Promise<WalletApi> };
export type WalletName = "lace" | "eternl";
export type WalletWindow = { cardano?: Partial<Record<WalletName, Provider>> };
export type ConnectedWallet = { api: WalletApi; payer: string; addressHex: string };
export type Draft = { payee: string; amount: string; asset: "tADA" | "tUSDM"; purpose: string; expiry: string; nonce: string };
export type FieldErrors = Partial<Record<keyof Draft | "payer", string>>;
export const NO_WALLET = "Install Lace or Eternl to sign";
export const WRONG_NETWORK = "Switch your wallet to a testnet (preprod)";
export const CANCELLED = "Signing cancelled";

export function installedWallets(source: WalletWindow): WalletName[] {
  return (["lace", "eternl"] as const).filter((name) => typeof source.cardano?.[name]?.enable === "function");
}
export function newNonce(random: Pick<Crypto, "getRandomValues"> = crypto): string {
  return bytesToHex(random.getRandomValues(new Uint8Array(16)));
}
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function expiryUtc(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Enter a valid date and time in UTC.");
  const date = new Date(`${value}:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 16) !== value) throw new Error("Enter a valid date and time in UTC.");
  return date.getTime() / 1000;
}
export function validateDraft(draft: Draft, payer: string, tusdmUnit?: string): { mandate?: Mandate; errors: FieldErrors } {
  const errors: FieldErrors = {};
  let amount = ""; let expiry = NaN;
  try { amount = decimalToAtomic(draft.amount); } catch { errors.amount = "Enter an amount greater than zero, with up to 6 decimal places."; }
  try { expiry = expiryUtc(draft.expiry); } catch { errors.expiry = "Enter a valid date and time in UTC."; }
  const messages: FieldErrors = {
    payer: "Connect a testnet wallet with a payment key address.", payee: "Enter a preprod payee address (addr_test1…) or a Masumi agent identifier.",
    amount: "Enter an amount greater than zero, with up to 6 decimal places.", asset: "tUSDM is unavailable on this page. Choose tADA.",
    purpose: "Enter a memo from 1 to 280 characters.", expiry: "Enter a valid date and time in UTC.", nonce: "Generate a new 16-byte nonce.",
  };
  if (draft.asset === "tUSDM" && !/^[0-9a-fA-F]{56}\.[0-9a-fA-F]{0,64}$/.test(tusdmUnit ?? "")) errors.asset = messages.asset;
  try {
    const mandate = parseMandate({ v: 1, network: "cardano:preprod", payer, payee: draft.payee.trim(),
      asset: draft.asset === "tADA" ? "lovelace" : tusdmUnit ?? "", amount, expiry, nonce: draft.nonce, purpose: draft.purpose.trim() });
    if (!Object.keys(errors).length) return { mandate, errors };
  } catch (error) {
    if (error instanceof MandateParseError) {
      for (const issue of (error.cause as { issues: { path: PropertyKey[] }[] }).issues) {
        const field = issue.path[0] as keyof FieldErrors;
        if (messages[field]) errors[field] = messages[field];
      }
    } else { throw error; }
  }
  return { errors };
}

export async function connectWallet(source: WalletWindow, name: WalletName): Promise<ConnectedWallet> {
  const provider = source.cardano?.[name];
  if (!provider || typeof provider.enable !== "function") throw new Error(NO_WALLET);
  let api: WalletApi; let network: number; let addressHex: string;
  try {
    api = await provider.enable(); network = await api.getNetworkId();
  } catch { throw new Error(CANCELLED); }
  if (network !== 0) throw new Error(WRONG_NETWORK);
  try { const used = await api.getUsedAddresses(); addressHex = used[0] ?? await api.getChangeAddress(); }
  catch { throw new Error("The wallet could not provide a payment address."); }
  try {
    const address = Address.fromHex(addressHex);
    if ((parseInt(addressHex.slice(0, 2), 16) & 15) !== 0) throw new Error();
    if (Address.getPaymentCredential(addressHex)?._tag !== "KeyHash") throw new Error();
    return { api, addressHex, payer: Address.toBech32(address) };
  } catch { throw new Error("Use a testnet address with a key-hash payment credential; script and reward addresses cannot sign a Mandate."); }
}

export async function signMandate(wallet: ConnectedWallet, input: Mandate): Promise<MandateBundle> {
  const mandate = parseMandate(input);
  if (mandate.payer !== wallet.payer) throw new Error("SIGNER_MISMATCH: reconnect the wallet before signing.");
  let network: number;
  try { network = await wallet.api.getNetworkId(); } catch { throw new Error(CANCELLED); }
  if (network !== 0) throw new Error(WRONG_NETWORK);
  let result: { signature: string; key: string };
  try { result = await wallet.api.signData(wallet.addressHex, bytesToHex(new TextEncoder().encode(jcs(mandate)))); }
  catch { throw new Error(CANCELLED); }
  const bundle: MandateBundle = { mandate, coseSign1: result?.signature, coseKey: result?.key, payerAddress: wallet.payer, digest: mandateDigest(mandate) };
  const verified = verifyMandate(bundle);
  if (!verified.ok) {
    let hashed = false;
    try {
      const sign1 = CBOR.fromCBORHex(bundle.coseSign1);
      if (Array.isArray(sign1)) {
        const protectedHeaders = sign1[0] instanceof Uint8Array ? CBOR.fromCBORBytes(sign1[0]) : null;
        hashed = (sign1[1] instanceof Map && sign1[1].get("hashed") === true)
          || (protectedHeaders instanceof Map && protectedHeaders.get("hashed") === true);
      }
    } catch { /* Only fixed explanations reach the page. */ }
    const explanation = {
      SIG_INVALID: hashed ? "This wallet signed a hashed payload; AgentPay Guard needs the raw payload." : "The wallet signature could not be verified.",
      SIGNER_MISMATCH: "The signing key does not match the Mandate payer.",
      DIGEST_MISMATCH: "The returned bundle does not match the Mandate digest.",
      BUNDLE_INVALID: "The wallet returned an invalid signature bundle.",
    };
    throw new Error(`${verified.reason}: ${explanation[verified.reason]}`);
  }
  return bundle;
}
