import { z } from "zod";

export const PaymentSchema = z.object({ txHash: z.string().regex(/^[0-9a-f]{64}$/),
  network: z.literal("cardano:preprod"), status: z.enum(["confirmed", "confirmed-on-chain", "mempool", "pending"]) });
export type Payment = z.infer<typeof PaymentSchema>;
export const RunTranscriptSchema = z.object({
  v: z.literal(1), scenario: z.enum(["S1", "S2"]), recorded: z.boolean(),
  startedAt: z.iso.datetime(), offerUrl: z.url(), injectedExcerpt: z.string().nullable(),
  steps: z.array(z.object({ at: z.iso.datetime(),
    kind: z.enum(["read-page", "instruction", "payment-required", "proposal", "hire", "receipt", "verify", "pay", "paid", "stop"]), text: z.string() })),
  taskId: z.string().nullable(), verdict: z.enum(["APPROVE", "REFUSE"]).nullable(),
  reasons: z.array(z.string()), diff: z.array(z.object({ field: z.string(), signed: z.string(), proposed: z.string() })),
  payment: PaymentSchema.nullable(),
});
export type RunTranscript = z.infer<typeof RunTranscriptSchema>;
