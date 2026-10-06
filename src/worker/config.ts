import { z } from "zod";
import { MandateSchema } from "../guard/mandate";
import { mpsBaseUrl } from "./mps";
import { WorkerError } from "./errors";

export function preprodOrigin(value: string): string {
  const url = new URL(value);
  if (url.origin !== "https://api.preprod.sokosumi.com" || url.username || url.password
    || url.search || url.hash || !["/", "/v1", "/v1/"].includes(url.pathname)) {
    throw new Error("Invalid Core origin");
  }
  return url.origin;
}

const schema = z.object({
  SOKOSUMI_API_URL: z.string().refine((value) => { try { preprodOrigin(value); return true; } catch { return false; } }),
  SOKOSUMI_COWORKER_API_KEY: z.string().min(1),
  SOKOSUMI_COWORKER_ID: z.string().min(1),
  DATABASE_URL: z.string().url().regex(/^postgres(?:ql)?:\/\//),
  GUARD_SIGNING_KEY: z.string().refine((value) => value.length === 64 && !/[^0-9a-fA-F]/.test(value)),
  GUARD_ADDRESS: MandateSchema.shape.payer,
  POLL_INTERVAL_MS: z.preprocess((value) => value === undefined || value === "" ? 10000 : Number(value), z.number().int().min(10000)),
  PAID_TASKS_ENABLED: z.preprocess((value) => value === undefined || value === "" ? "false" : value, z.enum(["true", "false"])),
});

const paidSchema = z.object({
  MPS_BASE_URL: z.string().refine((value) => { try { mpsBaseUrl(value); return true; } catch { return false; } }),
  MPS_RUNTIME_TOKEN: z.string().min(1),
  MASUMI_AGENT_IDENTIFIER: z.string().min(1),
  MASUMI_SUPPORTED_PAYMENT_SOURCE_INDEX: z.preprocess((value) => value === "" || value === undefined ? undefined : Number(value), z.number().int().nonnegative()),
  TUSDM_UNIT: z.string().refine((value) => value.length >= 56 && value.length <= 120 && value.length % 2 === 0 && !/[^0-9a-fA-F]/.test(value)),
  PAID_PAY_BY_MINUTES: minutes(20),
  PAID_SUBMIT_RESULT_MINUTES: minutes(60),
  PAID_UNLOCK_MINUTES: minutes(75),
  PAID_DISPUTE_MINUTES: minutes(90),
}).superRefine((value, ctx) => {
  const keys = ["PAID_PAY_BY_MINUTES", "PAID_SUBMIT_RESULT_MINUTES", "PAID_UNLOCK_MINUTES", "PAID_DISPUTE_MINUTES"] as const;
  for (let i = 1; i < keys.length; i++) {
    if (value[keys[i]] <= value[keys[i - 1]]) ctx.addIssue({ code: "custom", path: [keys[i]], message: "Offsets must increase" });
  }
});

function minutes(fallback: number) {
  return z.preprocess((value) => value === undefined || value === "" ? fallback
    : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN, z.number().int().positive());
}

function configError(error: z.ZodError): WorkerError {
  return new WorkerError(`Invalid Worker configuration: ${[...new Set(error.issues.map((issue) => String(issue.path[0])))].join(", ")}`);
}

export function loadConfig(env: Record<string, string | undefined>) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw configError(parsed.error);
  const value = parsed.data;
  let paid;
  // Keep paid credentials available for journaled paid Tasks even when new Tasks are free.
  if (value.PAID_TASKS_ENABLED === "true" || env.MPS_RUNTIME_TOKEN) {
    const checked = paidSchema.safeParse(env);
    if (!checked.success) throw configError(checked.error);
    const p = checked.data;
    paid = { baseUrl: mpsBaseUrl(p.MPS_BASE_URL), token: p.MPS_RUNTIME_TOKEN, agentIdentifier: p.MASUMI_AGENT_IDENTIFIER,
      supportedPaymentSourceIndex: p.MASUMI_SUPPORTED_PAYMENT_SOURCE_INDEX, tusdmUnit: p.TUSDM_UNIT,
      deadlines: { payBy: p.PAID_PAY_BY_MINUTES, submitResult: p.PAID_SUBMIT_RESULT_MINUTES, unlock: p.PAID_UNLOCK_MINUTES, dispute: p.PAID_DISPUTE_MINUTES } };
  }
  return {
    origin: preprodOrigin(value.SOKOSUMI_API_URL),
    apiKey: value.SOKOSUMI_COWORKER_API_KEY,
    coworkerId: value.SOKOSUMI_COWORKER_ID,
    databaseUrl: value.DATABASE_URL,
    guardKey: { privateKeyHex: value.GUARD_SIGNING_KEY, address: value.GUARD_ADDRESS },
    pollIntervalMs: value.POLL_INTERVAL_MS,
    paidTasksEnabled: value.PAID_TASKS_ENABLED === "true",
    paid,
  };
}
