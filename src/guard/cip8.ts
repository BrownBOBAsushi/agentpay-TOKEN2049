import { Address, CBOR, COSE, Credential } from "@evolution-sdk/evolution";
import { MandateBundleSchema } from "./bundle";
import { mandateDigest } from "./digest";
import { jcs } from "./jcs";

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "SIG_INVALID" | "SIGNER_MISMATCH" | "DIGEST_MISMATCH" | "BUNDLE_INVALID" };

export function verifyMandate(input: unknown): VerifyResult {
  let failureReason: Extract<VerifyResult, { ok: false }>["reason"] = "BUNDLE_INVALID";
  try {
    const parsed = MandateBundleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: "BUNDLE_INVALID" };
    const bundle = parsed.data;
    if (bundle.digest !== mandateDigest(bundle.mandate)) {
      return { ok: false, reason: "DIGEST_MISMATCH" };
    }

    failureReason = "SIGNER_MISMATCH";
    if (bundle.payerAddress !== bundle.mandate.payer) {
      return { ok: false, reason: "SIGNER_MISMATCH" };
    }
    const addressHex = Address.toHex(Address.fromBech32(bundle.payerAddress));
    const credential = Address.getPaymentCredential(addressHex);
    if (credential?._tag !== "KeyHash") return { ok: false, reason: "SIGNER_MISMATCH" };

    failureReason = "SIG_INVALID";
    const signature = Buffer.from(bundle.coseSign1, "hex");
    const key = Buffer.from(bundle.coseKey, "hex");
    const decodedKey = CBOR.fromCBORBytes(key);
    if (!(decodedKey instanceof Map)) return { ok: false, reason: "SIG_INVALID" };
    const publicKey = decodedKey.get(-2n);
    // COSE: kty=OKP, alg=EdDSA, crv=Ed25519, x=32 bytes, no private d.
    if (decodedKey.get(1n) !== 1n || decodedKey.get(3n) !== -8n || decodedKey.get(-1n) !== 6n
      || !(publicKey instanceof Uint8Array) || publicKey.length !== 32 || decodedKey.has(-4n)) {
      return { ok: false, reason: "SIG_INVALID" };
    }

    const sign1 = CBOR.fromCBORBytes(signature);
    if (!Array.isArray(sign1) || sign1.length !== 4 || !(sign1[0] instanceof Uint8Array)
      || !(sign1[1] instanceof Map) || sign1[1].get("hashed") !== false) {
      return { ok: false, reason: "SIG_INVALID" };
    }
    const protectedHeaders = CBOR.fromCBORBytes(sign1[0]);
    if (!(protectedHeaders instanceof Map)
      || (protectedHeaders.has("hashed") && protectedHeaders.get("hashed") !== false)) {
      return { ok: false, reason: "SIG_INVALID" };
    }

    const payload = Buffer.from(jcs(bundle.mandate), "utf8");
    return COSE.SignData.verifyData(addressHex, Credential.toHex(credential), payload, { signature, key })
      ? { ok: true }
      : { ok: false, reason: "SIG_INVALID" };
  } catch {
    return { ok: false, reason: failureReason };
  }
}
