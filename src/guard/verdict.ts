export type ReasonCode =
  | "CONTEXT_INVALID"
  | "SIG_INVALID" | "SIGNER_MISMATCH" | "DIGEST_MISMATCH" | "BUNDLE_INVALID"
  | "MANDATE_EXPIRED" | "NONCE_REUSED" | "PROPOSAL_INVALID"
  | "NETWORK_MISMATCH" | "SCHEME_MISMATCH" | "PAYEE_MISMATCH"
  | "ASSET_MISMATCH" | "AMOUNT_MISMATCH" | "DEADLINE_AFTER_EXPIRY";

export type DiffEntry = { field: string; signed: string; proposed: string };
export type Verdict = { verdict: "APPROVE" | "REFUSE"; reasons: ReasonCode[]; diff: DiffEntry[] };
