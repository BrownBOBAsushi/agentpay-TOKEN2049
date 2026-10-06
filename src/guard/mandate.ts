import { z } from "zod";
import { isPreprodBech32Address } from "./bech32";

// This schema checks the Mandate's shape. CIP-8 verification is a separate step.
export const MandateSchema = z.strictObject({
  v: z.literal(1),
  network: z.literal("cardano:preprod"),
  payer: z.string().refine(isPreprodBech32Address, "Invalid lowercase addr_test bech32 address"),
  payee: z.string().min(1),
  asset: z.string().regex(/^(?:lovelace|[0-9a-fA-F]{56}\.[0-9a-fA-F]{0,64})$/),
  amount: z.string().regex(/^[1-9][0-9]*$/),
  expiry: z.number().int(),
  nonce: z.string().regex(/^[0-9a-fA-F]{32}$/),
  purpose: z.string().min(1).max(280),
});

export type Mandate = z.infer<typeof MandateSchema>;

export class MandateParseError extends Error {
  constructor(cause: z.ZodError) {
    super("Invalid Mandate", { cause });
    this.name = "MandateParseError";
  }
}

export function parseMandate(input: unknown): Mandate {
  const result = MandateSchema.safeParse(input);
  if (!result.success) {
    throw new MandateParseError(result.error);
  }
  return result.data;
}
