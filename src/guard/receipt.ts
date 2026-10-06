import { createHash } from "node:crypto";
import { Address, CBOR, COSE, Credential, KeyHash, PrivateKey } from "@evolution-sdk/evolution";
import { z } from "zod";
import { isPreprodBech32Address } from "./bech32";
import { isValidCoseKey } from "./cip8";
import { jcs } from "./jcs";
import type { SpendProposal } from "./proposal";
import type { Verdict } from "./verdict";

export type GuardReceipt = Verdict & {
  v: 1;
  mandateDigest: string;
  proposalDigest: string;
  taskId: string;
  ts: number;
};
export type SignedReceipt = {
  receipt: GuardReceipt;
  coseSign1: string;
  coseKey: string;
  guardAddress: string;
  digest: string;
};

const hexBytes = z.string().refine((value) => value.length > 0 && value.length % 2 === 0 && !/[^0-9a-fA-F]/.test(value));
const digestHex = hexBytes.refine((value) => value.length === 64);
const receiptSchema: z.ZodType<GuardReceipt> = z.strictObject({
  v: z.literal(1),
  verdict: z.enum(["APPROVE", "REFUSE"]),
  reasons: z.array(z.enum([
    "CONTEXT_INVALID", "SIG_INVALID", "SIGNER_MISMATCH", "DIGEST_MISMATCH", "BUNDLE_INVALID",
    "MANDATE_EXPIRED", "NONCE_REUSED", "PROPOSAL_INVALID", "NETWORK_MISMATCH", "SCHEME_MISMATCH",
    "PAYEE_MISMATCH", "ASSET_MISMATCH", "AMOUNT_MISMATCH", "DEADLINE_AFTER_EXPIRY",
  ])),
  diff: z.array(z.strictObject({ field: z.string(), signed: z.string(), proposed: z.string() })),
  mandateDigest: digestHex,
  proposalDigest: digestHex,
  taskId: z.string().min(1),
  ts: z.number().int().nonnegative(),
});
const signedReceiptSchema = z.strictObject({
  receipt: receiptSchema,
  coseSign1: hexBytes,
  coseKey: hexBytes,
  guardAddress: z.string().refine(isPreprodBech32Address),
  digest: digestHex,
});

export function proposalDigest(proposal: SpendProposal): string {
  return createHash("sha256").update("agentpay:proposal:v1\n" + jcs(proposal), "utf8").digest("hex");
}

export function receiptDigest(receipt: GuardReceipt): string {
  return createHash("sha256").update("agentpay:receipt:v1\n" + jcs(receipt), "utf8").digest("hex");
}

function guardIdentity(address: string): { addressHex: string; keyHash: string } {
  if (!isPreprodBech32Address(address)) throw new Error("Invalid Guard address");
  const addressHex = Address.toHex(Address.fromBech32(address));
  const credential = Address.getPaymentCredential(addressHex);
  if ((parseInt(addressHex.slice(0, 2), 16) & 15) !== 0 || credential?._tag !== "KeyHash") {
    throw new Error("Guard address must have a preprod payment key credential");
  }
  return { addressHex, keyHash: Credential.toHex(credential) };
}

export function signReceipt(receipt: GuardReceipt, guardKey: { privateKeyHex: string; address: string }): SignedReceipt {
  const parsed = receiptSchema.parse(receipt);
  const identity = guardIdentity(guardKey.address);
  let privateKey: PrivateKey.PrivateKey;
  try {
    privateKey = PrivateKey.fromHex(guardKey.privateKeyHex);
  } catch {
    // Do not include key material in errors from the SDK parser.
    throw new Error("Invalid Guard signing key");
  }
  if (KeyHash.toHex(KeyHash.fromPrivateKey(privateKey)) !== identity.keyHash) {
    throw new Error("Guard signing key does not match Guard address");
  }
  const signed = COSE.SignData.signData(identity.addressHex, Buffer.from(jcs(parsed), "utf8"), privateKey);
  return {
    receipt: parsed,
    coseSign1: Buffer.from(signed.signature).toString("hex"),
    coseKey: Buffer.from(signed.key).toString("hex"),
    guardAddress: guardKey.address,
    digest: receiptDigest(parsed),
  };
}

export function verifyReceipt(input: unknown, expectedGuardAddress: string): boolean {
  try {
    const parsed = signedReceiptSchema.safeParse(input);
    if (!parsed.success) return false;
    const signed = parsed.data;
    if (signed.guardAddress !== expectedGuardAddress || signed.digest !== receiptDigest(signed.receipt)) return false;
    const identity = guardIdentity(expectedGuardAddress);
    const key = Buffer.from(signed.coseKey, "hex");
    const signature = Buffer.from(signed.coseSign1, "hex");
    if (!isValidCoseKey(key)) return false;
    const sign1 = CBOR.fromCBORBytes(signature);
    if (!Array.isArray(sign1) || sign1.length !== 4 || !(sign1[0] instanceof Uint8Array)
      || !(sign1[1] instanceof Map) || sign1[1].get("hashed") !== false) return false;
    const protectedHeaders = CBOR.fromCBORBytes(sign1[0]);
    if (!(protectedHeaders instanceof Map)
      || (protectedHeaders.has("hashed") && protectedHeaders.get("hashed") !== false)) return false;
    return COSE.SignData.verifyData(identity.addressHex, identity.keyHash, Buffer.from(jcs(signed.receipt), "utf8"), { signature, key });
  } catch {
    return false;
  }
}
