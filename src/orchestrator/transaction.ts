import { SlotConfig, Transaction, TransactionBody, TransactionHash } from "@evolution-sdk/evolution";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";
import { proposalDigest, SpendProposalSchema, type SpendProposal } from "../guard";
import { StopError } from "./journal";

export function inspectPayment(payload: PaymentPayload, proposal: SpendProposal, mandateExpiry: number): string {
  try {
    if (!Number.isSafeInteger(mandateExpiry) || payload.x402Version !== 2
      || proposal.requirements.network !== "cardano:preprod"
      || proposalDigest(SpendProposalSchema.parse({ kind: "x402", requirements: payload.accepted })) !== proposalDigest(proposal)) {
      throw new StopError("signed payment does not match the approved preprod proposal");
    }
    const encoded = payload.payload.transaction;
    if (typeof encoded !== "string" || !encoded || Buffer.from(encoded, "base64").toString("base64") !== encoded) {
      throw new StopError("signed transaction invalid");
    }
    const bytes = Buffer.from(encoded, "base64");
    const tx = Transaction.fromCBORBytes(bytes);
    if (!tx.isValid) throw new StopError("signed transaction invalid");
    if (tx.body.ttl === undefined) throw new StopError("transaction TTL missing; no payment released");
    const config = SlotConfig.getSlotConfig("Preprod");
    const expiresAt = config.zeroTime + (tx.body.ttl - config.zeroSlot) * BigInt(config.slotLength);
    if (expiresAt > BigInt(mandateExpiry) * 1000n) throw new StopError("transaction TTL exceeds Mandate expiry; no payment released");
    // Hash the original body bytes, not a re-encoded body. CBOR encoding is part of the tx id.
    return TransactionHash.toHex(TransactionBody.toHashFromBytes(Transaction.extractBodyBytes(bytes)));
  } catch (error) {
    if (error instanceof StopError) throw error;
    throw new StopError("signed transaction invalid; no payment released");
  }
}

export function inspectHeaders(headers: Record<string, string>, proposal: SpendProposal, mandateExpiry: number): string {
  try {
    const signature = new Headers(headers).get("PAYMENT-SIGNATURE");
    if (!signature) throw new StopError("payment signature missing");
    return inspectPayment(decodePaymentSignatureHeader(signature), proposal, mandateExpiry);
  } catch (error) {
    if (error instanceof StopError) throw error;
    throw new StopError("signed transaction invalid; no payment released");
  }
}
