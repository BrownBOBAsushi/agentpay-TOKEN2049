import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { jcs } from "../guard/jcs";
import { StoreTaskIdSchema } from "./store-hire-contract";

export const STORE_TASK_TOKEN_TTL = 15 * 60;
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const payloadSchema = z.strictObject({ taskId: StoreTaskIdSchema, exp: z.number().int().positive().safe(),
  mandateDigest: digest, proposalDigest: digest });
type Binding = Omit<z.infer<typeof payloadSchema>, "exp">;

export function storeTaskTokenKey(apiKey: string, secret?: string): Buffer {
  return secret ? Buffer.from(secret, "utf8")
    : createHmac("sha256", apiKey).update("agentpay:store-task-token:key:v1\n", "utf8").digest();
}
export function issueStoreTaskToken(binding: Binding, key: Buffer, nowSec: number): string {
  const payload = jcs(payloadSchema.parse({ ...binding, exp: nowSec + STORE_TASK_TOKEN_TTL }));
  const signature = createHmac("sha256", key).update(payload, "utf8").digest("base64url");
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${signature}`;
}
export function verifyStoreTaskToken(token: string | null | undefined, key: Buffer, binding: Binding, nowSec: number): boolean {
  const payload = readStoreTaskToken(token, key, nowSec);
  return !!payload && payload.taskId === binding.taskId && payload.mandateDigest === binding.mandateDigest
    && payload.proposalDigest === binding.proposalDigest;
}
// Only authenticated, canonical, unexpired claims may select a live Task's Mandate digest.
export function readStoreTaskToken(token: string | null | undefined, key: Buffer, nowSec: number): z.infer<typeof payloadSchema> | null {
  try {
    if (!token || token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const [encoded, signature] = token.split(".");
    const bytes = Buffer.from(encoded, "base64url"), supplied = Buffer.from(signature, "base64url");
    if (bytes.toString("base64url") !== encoded || supplied.toString("base64url") !== signature || supplied.length !== 32) return null;
    const expected = createHmac("sha256", key).update(bytes).digest();
    if (!timingSafeEqual(expected, supplied)) return null;
    const text = bytes.toString("utf8"), payload = payloadSchema.parse(JSON.parse(text));
    return text === jcs(payload) && payload.exp > nowSec && payload.exp <= nowSec + STORE_TASK_TOKEN_TTL ? payload : null;
  } catch { return null; }
}
