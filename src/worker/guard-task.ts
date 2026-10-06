import { z } from "zod";
import { guardCheck, MandateBundleSchema, mandateDigest, proposalDigest, signReceipt } from "../guard";
import type { SpendProposal, Verdict } from "../guard";
import type { createStore } from "./store";

export type GuardTaskInput = {
  taskId: string; description: string; nowSec: number;
  store: ReturnType<typeof createStore>;
  guardKey: { privateKeyHex: string; address: string };
};

export async function runGuardTask(input: GuardTaskInput): Promise<string> {
  let verdict: Verdict = { verdict: "REFUSE", reasons: ["PROPOSAL_INVALID"], diff: [] };
  // No valid input exists on a parse failure; these digests mark unavailable inputs.
  let mandateHash = "0".repeat(64);
  let proposalHash = "0".repeat(64);
  let taskInput: { mandateBundle: unknown; proposal: unknown } | undefined;
  try {
    taskInput = z.object({ mandateBundle: z.unknown().refine((value) => value !== undefined), proposal: z.unknown().refine((value) => value !== undefined) })
      .parse(JSON.parse(input.description));
    // Hash the original JSON proposal, including its extra metadata.
    proposalHash = proposalDigest(taskInput.proposal as SpendProposal);
  } catch {
    taskInput = undefined;
  }
  if (taskInput) {
    const bundle = MandateBundleSchema.safeParse(taskInput.mandateBundle);
    let nonceUsed = false;
    if (bundle.success) {
      mandateHash = mandateDigest(bundle.data.mandate);
      nonceUsed = await input.store.isNonceUsed(bundle.data.mandate.payer, bundle.data.mandate.nonce, input.taskId);
    }
    verdict = guardCheck({ bundle: taskInput.mandateBundle, proposal: taskInput.proposal }, { nowSec: input.nowSec, nonceUsed });
    if (verdict.verdict === "APPROVE" && bundle.success) {
      const claimed = await input.store.consumeNonce(bundle.data.mandate.payer, bundle.data.mandate.nonce, input.taskId);
      if (!claimed) verdict = { verdict: "REFUSE", reasons: ["NONCE_REUSED"], diff: [] };
    }
  }
  return JSON.stringify(signReceipt({ v: 1, ...verdict, mandateDigest: mandateHash, proposalDigest: proposalHash, taskId: input.taskId, ts: input.nowSec }, input.guardKey));
}
