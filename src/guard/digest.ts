import { createHash } from "node:crypto";
import { jcs } from "./jcs";
import type { Mandate } from "./mandate";

export const MANDATE_PREFIX = "agentpay:mandate:v1\n";

export function mandateDigest(mandate: Mandate): string {
  return createHash("sha256")
    .update(MANDATE_PREFIX + jcs(mandate), "utf8")
    .digest("hex");
}
