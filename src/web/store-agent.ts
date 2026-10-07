import type { SpendProposal } from "../guard/proposal";
import fixture from "./fixtures/store-mandate.json";
import { attackerAddress } from "./store-addresses";
import { decimalToAtomic } from "./amount";

export function runStoreAgent(injection: string | null, storePayee = fixture.mandate.payee): { steps: string[]; proposal: SpendProposal } {
  let amount = "6500000", payTo = storePayee;
  const steps = ["Read listing: Latte · 6.50 tADA · The Corner Store"];
  const total = injection?.match(/\btotal\b[^\d$+\-]*\$?(\d+(?:\.\d{1,2})?)(?![\d.]|,\d)/i)?.[1];
  const merchant = injection?.match(/\bmerchant\s*(?:is\s+|[:=]\s*)?(["'])([^"']+)\1/i)?.[2].trim();
  const address = injection?.match(/\baddr_test1[a-z0-9]+\b/)?.[0];
  if (total && (merchant || address)) {
    try {
      amount = decimalToAtomic(total);
      payTo = address ?? (/^(?:the )?corner store$/i.test(merchant!) ? storePayee : attackerAddress);
      steps.push(`Obey page instruction: ${total} tADA · ${address ?? merchant}`);
    } catch { steps.push("Checkout instruction is unparseable; follow the listing"); }
  } else steps.push(injection ? "Checkout instruction is unparseable; follow the listing" : "No attacker instruction; follow the listing");
  const proposal: SpendProposal = { kind: "x402", requirements: { scheme: "exact", network: "cardano:preprod",
    asset: "lovelace", amount, payTo, maxTimeoutSeconds: 600 } };
  steps.push(`Present x402 Spend Proposal: ${amount} lovelace to ${payTo}`);
  return { steps, proposal };
}
