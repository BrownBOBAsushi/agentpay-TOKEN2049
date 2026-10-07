import "server-only";
import { StopError } from "../orchestrator/journal";

// Only fixed application messages are safe. SDK/pg Error messages, stacks and
// causes may contain keys, request headers, connection strings or SQL params.
const stopMessages = new Set([
  "Durable store payment database operation failed; inspect saved state before retrying.",
  "Payment signing is interrupted or in progress. No second transaction will be signed; inspect the durable store payment.",
  "Durable store payment database configuration missing.", "Durable store payment row invalid; no signing",
  "expected a payment action", "durable payment proposal mismatch; no signing",
  "saved payment does not match the approved proposal; no payment", "durable payment claim event invalid; no signing",
  "saved payment bytes missing; no second payment", "saved payment result invalid; no second payment",
  "durable payment input mismatch; no payment", "durable payment state changed; inspect saved result before retrying",
  "expected PAYMENT-REQUIRED (402)", "expected x402 v2", "unsupported preprod payment requirements",
  "preprod wallet configuration missing", "preprod transaction lookup configuration missing",
  "preprod transaction lookup failed; saved signature retained", "Mandate expires before payment deadline; no payment",
  "requirements changed; no payment signed", "durable payment claim unavailable; no signing",
  "payment signing was interrupted; do not build a second transaction",
  "saved payment does not match the approved proposal and endpoint", "saved payment result missing; no second payment",
  "fresh payment requirements missing; no signing", "saved payment signature missing", "saved transaction hash mismatch",
  "transaction expired unsettled; no payment", "signed payment does not match the approved preprod proposal",
  "signed transaction invalid", "transaction TTL missing; no payment released",
  "transaction TTL exceeds Mandate expiry; no payment released", "signed transaction invalid; no payment released",
  "payment signature missing", "payment request deadline reached; saved state retained",
  "prepared payment unavailable for recovery; no signing",
]);
const errorClasses = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "DOMException", "DatabaseError", "ZodError",
  "StopError", "StoreSigningInterruptedError", "StorePaymentDatabaseError"]);
export function paymentPgCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = "pgCode" in error ? error.pgCode : "code" in error ? error.code : undefined;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

export function logStorePaymentFailure(error: unknown, stage: "payment" | "recovery" | "state" | "request" | "pool", env: NodeJS.ProcessEnv = process.env) {
  const name = error instanceof Error ? error.constructor.name : "UnknownError";
  const secrets = [env.STORE_LIVE_KEY, env.ORCHESTRATOR_WALLET_MNEMONIC, env.BLOCKFROST_API_KEY_PREPROD,
    env.STORE_PAY_DATABASE_URL, env.SOKOSUMI_COWORKER_API_KEY, env.GUARD_SIGNING_KEY].filter((value): value is string => !!value);
  let message = error instanceof StopError ? (stopMessages.has(error.message) ? error.message : "Unrecognized StopError message omitted.") : undefined;
  for (const secret of secrets) message = message?.replaceAll(secret, "[redacted]");
  const pgCode = paymentPgCode(error);
  const operation = error && typeof error === "object" && "operation" in error
    && ["read", "claim", "prepare", "done"].includes(String(error.operation)) ? String(error.operation) : undefined;
  console.error("[store-pay] failure", { stage, errorClass: errorClasses.has(name) ? name : "UnknownError",
    ...(message ? { message } : {}), ...(pgCode && !secrets.includes(pgCode) ? { pgCode } : {}), ...(operation ? { operation } : {}) });
}
