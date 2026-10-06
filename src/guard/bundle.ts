import { z } from "zod";
import { MandateSchema } from "./mandate";

const HexBytes = z.string().refine(
  (value) => value.length > 0 && value.length % 2 === 0 && !/[^0-9a-fA-F]/.test(value),
  "Expected non-empty hex bytes",
);

export const MandateBundleSchema = z.strictObject({
  mandate: MandateSchema,
  coseSign1: HexBytes,
  coseKey: HexBytes,
  payerAddress: z.string().min(1),
  digest: HexBytes.refine((value) => value.length === 64, "Expected a 32-byte digest"),
});

export type MandateBundle = z.infer<typeof MandateBundleSchema>;
