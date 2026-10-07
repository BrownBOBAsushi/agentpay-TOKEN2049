import { z } from "zod";
import { StoreResultSchema } from "./store-contract";

export const StoreTaskIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const StoreHireSchema = z.discriminatedUnion("mode", [
  StoreResultSchema.extend({ mode: z.literal("local"), note: z.string() }),
  z.object({ mode: z.literal("hired"), taskId: StoreTaskIdSchema, taskToken: z.string().min(1).max(1024), steps: z.array(z.string()),
    proposal: StoreResultSchema.shape.proposal, local: StoreResultSchema }),
]);
export const StoreHireStatusSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("failed"), receiptValid: z.literal(false), note: z.string() }),
  z.object({ status: z.literal("completed"), receiptValid: z.literal(true), verdict: StoreResultSchema.shape.verdict,
    reasons: StoreResultSchema.shape.reasons, diff: StoreResultSchema.shape.diff,
    proposalDigest: z.string().regex(/^[0-9a-f]{64}$/), mandateDigest: z.string().regex(/^[0-9a-f]{64}$/) }),
]);
