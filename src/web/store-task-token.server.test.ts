import { createHmac } from "node:crypto";
import { expect, it, vi } from "vitest";
import { jcs } from "../guard/jcs";
import { issueStoreTaskToken, storeTaskTokenKey, verifyStoreTaskToken, STORE_TASK_TOKEN_TTL } from "./store-task-token.server";
vi.mock("server-only", () => ({}));
// Public synthetic key material, never used in a deployment.
const secret = "TEST-STORE-TASK-TOKEN-SECRET-000000", apiKey = "TEST-COWORKER-CREDENTIAL";
const key = storeTaskTokenKey(apiKey, secret), now = 1791330000;
const binding = { taskId: "token-test-task", mandateDigest: "a".repeat(64), proposalDigest: "b".repeat(64) };
const token = issueStoreTaskToken(binding, key, now);
it("signs exactly the canonical public payload with HMAC-SHA256", () => {
  const [encoded, signature] = token.split("."); const text = Buffer.from(encoded, "base64url").toString("utf8");
  expect(text).toBe(jcs({ ...binding, exp: now + 900 }));
  expect(signature).toBe(createHmac("sha256", secret).update(text, "utf8").digest("base64url"));
  expect(verifyStoreTaskToken(token, key, binding, now)).toBe(true);
  expect(text).not.toContain(secret); expect(text).not.toContain(apiKey);
});
it("uses a domain-separated derived key only when the dedicated secret is absent", () => {
  const derived = storeTaskTokenKey(apiKey);
  expect(derived).toEqual(createHmac("sha256", apiKey).update("agentpay:store-task-token:key:v1\n").digest());
  expect(derived.equals(Buffer.from(apiKey))).toBe(false);
  const fallbackToken = issueStoreTaskToken(binding, derived, now);
  expect(verifyStoreTaskToken(fallbackToken, derived, binding, now)).toBe(true);
  expect(verifyStoreTaskToken(fallbackToken, key, binding, now)).toBe(false);
});
it("expires at 15 minutes and rejects a correctly signed expiry beyond that limit", () => {
  expect(STORE_TASK_TOKEN_TTL).toBe(900);
  expect(verifyStoreTaskToken(token, key, binding, now + 899)).toBe(true);
  expect(verifyStoreTaskToken(token, key, binding, now + 900)).toBe(false);
  expect(verifyStoreTaskToken(issueStoreTaskToken(binding, key, now + 1), key, binding, now)).toBe(false);
});
it.each(["taskId", "mandateDigest", "proposalDigest"] as const)("checks %s binding even with a valid HMAC", (field) => {
  const wrong = { ...binding, [field]: field === "taskId" ? "different-task" : "c".repeat(64) };
  expect(verifyStoreTaskToken(issueStoreTaskToken(wrong, key, now), key, binding, now)).toBe(false);
});
it("rejects edited payloads, alternate serialization and malformed tokens", () => {
  const changed = Buffer.from(jcs({ ...binding, exp: now + 899 }), "utf8").toString("base64url");
  expect(verifyStoreTaskToken(`${changed}.${token.split(".")[1]}`, key, binding, now)).toBe(false);
  const noncanonical = JSON.stringify({ ...binding, exp: now + 900 });
  const signed = `${Buffer.from(noncanonical).toString("base64url")}.${createHmac("sha256", key).update(noncanonical).digest("base64url")}`;
  expect(verifyStoreTaskToken(signed, key, binding, now)).toBe(false);
  for (const input of [undefined, "", "x".repeat(1025), "e30.bad", `${token}.extra`]) {
    expect(verifyStoreTaskToken(input, key, binding, now)).toBe(false);
  }
});
