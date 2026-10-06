import { z } from "zod";

export const X402ProposalSchema = z.object({
  kind: z.literal("x402"),
  requirements: z.object({
    // Keep these as strings so the matcher can report network/scheme mismatches.
    scheme: z.string().min(1),
    network: z.string().min(1),
    amount: z.string().regex(/^[1-9][0-9]*(?![\s\S])/),
    asset: z.string().regex(/^(?:lovelace|[0-9a-fA-F]{56}\.[0-9a-fA-F]{0,64})(?![\s\S])/),
    payTo: z.string().min(1),
    maxTimeoutSeconds: z.number().int().nonnegative(),
    extra: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const SpendProposalSchema = z.discriminatedUnion("kind", [X402ProposalSchema]);
export type SpendProposal = z.infer<typeof SpendProposalSchema>;
export type X402Requirements = z.infer<typeof X402ProposalSchema>["requirements"];
