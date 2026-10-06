import { z } from "zod";
import { MandateSchema } from "../guard/mandate";

export function preprodOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== "https://api.preprod.sokosumi.com" || url.username || url.password
    || url.search || url.hash || !["/", "/v1", "/v1/"].includes(url.pathname)) {
    throw new Error("Invalid Core origin");
  }
  return url.origin;
}

const schema = z.object({
  SOKOSUMI_API_URL: z.string().transform(preprodOrigin),
  SOKOSUMI_COWORKER_API_KEY: z.string().min(1),
  SOKOSUMI_COWORKER_ID: z.string().min(1),
  DATABASE_URL: z.string().url().refine((value) => ["postgres:", "postgresql:"].includes(new URL(value).protocol)),
  GUARD_SIGNING_KEY: z.string().refine((value) => value.length === 64 && !/[^0-9a-fA-F]/.test(value)),
  GUARD_ADDRESS: MandateSchema.shape.payer,
  POLL_INTERVAL_MS: z.preprocess((value) => value === undefined || value === "" ? 10000 : Number(value), z.number().int().min(10000)),
});

export function loadConfig(env: Record<string, string | undefined>) {
  try {
    const value = schema.parse(env);
    return {
      origin: value.SOKOSUMI_API_URL,
      apiKey: value.SOKOSUMI_COWORKER_API_KEY,
      coworkerId: value.SOKOSUMI_COWORKER_ID,
      databaseUrl: value.DATABASE_URL,
      guardKey: { privateKeyHex: value.GUARD_SIGNING_KEY, address: value.GUARD_ADDRESS },
      pollIntervalMs: value.POLL_INTERVAL_MS,
    };
  } catch {
    throw new Error("Invalid Worker configuration");
  }
}
