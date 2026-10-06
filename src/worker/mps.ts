import { isIP } from "node:net";
import { z } from "zod";
import { WorkerError } from "./errors";

export type PaymentRequest = {
  network: "Preprod"; agentIdentifier: string; paymentSourceType: "Web3CardanoV2";
  supportedPaymentSourceIndex: number; inputHash: string; identifierFromPurchaser: string;
  RequestedFunds: { amount: string; unit: string }[];
  payByTime: string; submitResultTime: string; unlockTime: string; externalDisputeUnlockTime: string; metadata: string;
};

export function mpsBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    const loopback = url.hostname === "localhost" || url.hostname === "[::1]"
      || (isIP(url.hostname) === 4 && url.hostname.startsWith("127."));
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
      || url.username || url.password || url.search || url.hash
      || !["/", "/api/v1", "/api/v1/"].includes(url.pathname)) throw new Error();
    return `${url.origin}/api/v1`;
  } catch { throw new WorkerError("Invalid MPS base URL"); }
}

export function createMpsClient(options: { baseUrl: string; token: string; fetch: typeof fetch }) {
  const base = mpsBaseUrl(options.baseUrl);
  async function request(path: string, body: { network: string } & Record<string, unknown>): Promise<unknown> {
    if (body.network !== "Preprod") throw new WorkerError("MPS requires Preprod");
    let response: Response;
    try {
      response = await options.fetch(`${base}${path}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { token: options.token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch { throw new WorkerError("MPS transport failed"); }
    if (!response.ok) throw new WorkerError(`MPS HTTP ${response.status}`);
    let raw: unknown;
    try { raw = await response.json(); }
    catch { throw new WorkerError(`MPS returned invalid JSON (HTTP ${response.status})`); }
    const parsed = z.object({ status: z.literal("success"), data: z.unknown().refine((value) => value !== undefined) }).safeParse(raw);
    if (!parsed.success) throw new WorkerError("MPS returned invalid response");
    return parsed.data.data;
  }
  return {
    createPayment: (body: PaymentRequest) => request("/payment", body),
    resolve: (blockchainIdentifier: string) => request("/payment/resolve-blockchain-identifier", { network: "Preprod", blockchainIdentifier, includeHistory: "true" }),
    submitResult: (blockchainIdentifier: string, hash: string) => request("/payment/submit-result", { network: "Preprod", blockchainIdentifier, submitResultHash: hash }),
  };
}
export type MpsClient = ReturnType<typeof createMpsClient>;
