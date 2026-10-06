import { isIP } from "node:net";
import { z } from "zod";
import { WorkerError } from "./errors";

const listedPaymentSchema = z.object({ id: z.string().min(1), createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))), metadata: z.string().nullable(), inputHash: z.string() }).passthrough();
export type ListedPayment = z.infer<typeof listedPaymentSchema>;

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
  async function request(path: string, body?: { network: string } & Record<string, unknown>): Promise<unknown> {
    if (body && body.network !== "Preprod") throw new WorkerError("MPS requires Preprod");
    let response: Response;
    try {
      response = await options.fetch(`${base}${path}`, { method: body ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { token: options.token, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new WorkerError("MPS transport failed"); }
    if (!response.ok) {
      let detail = "";
      try {
        const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(await response.json());
        if (parsed.success) {
          const message = parsed.data.error.message;
          // Emit only the recognized prefix, never its arbitrary server-supplied suffix.
          const prefix = ["sellerReturnAddress must be", "Unauthorized", "Payment source", "Invalid input"]
            .find((value) => message.startsWith(value));
          if (prefix && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(message)
            && !(options.token && prefix.includes(options.token))) detail = prefix;
        }
      } catch { /* Non-JSON responses provide no safe diagnostic. */ }
      const message = detail ? `MPS HTTP ${response.status}: ${detail}` : `MPS error (HTTP ${response.status})`;
      throw new WorkerError(message);
    }
    let raw: unknown;
    try { raw = await response.json(); }
    catch { throw new WorkerError(`MPS returned invalid JSON (HTTP ${response.status})`); }
    const parsed = z.object({ status: z.literal("success"), data: z.unknown().refine((value) => value !== undefined) }).safeParse(raw);
    if (!parsed.success) throw new WorkerError("MPS returned invalid response");
    return parsed.data.data;
  }
  return {
    async *listPayments(scan: { agentIdentifier: string; termsTimeMs: number }): AsyncGenerator<ListedPayment> {
      const cutoff = scan.termsTimeMs - 600_000;
      if (!scan.agentIdentifier || !Number.isFinite(cutoff)) throw new WorkerError("Invalid payment scan context");
      let cursor: string | undefined;
      const seen = new Set<string>();
      for (let page = 0; page < 5; page++) {
        const query = new URLSearchParams({ network: "Preprod", filterPaymentSourceType: "Web3CardanoV2", filterAgentIdentifier: scan.agentIdentifier, limit: "50" });
        if (cursor) query.set("cursorId", cursor);
        const parsed = z.object({ Payments: z.array(listedPaymentSchema) }).safeParse(await request(`/payment?${query}`));
        if (!parsed.success || parsed.data.Payments.length > 50) throw new WorkerError("Invalid MPS payment list");
        // MPS uses an inclusive cursor: the previous page's last row appears again.
        const payments = parsed.data.Payments;
        const fresh = payments[0]?.id === cursor ? payments.slice(1) : payments;
        if (!fresh.length) return;
        for (const payment of fresh) {
          if (Date.parse(payment.createdAt) < cutoff) return;
          if (seen.has(payment.id)) throw new WorkerError("MPS payment pagination did not advance");
          seen.add(payment.id);
          yield payment;
        }
        if (payments.length < 50) return;
        cursor = fresh[fresh.length - 1].id;
      }
      throw new WorkerError("MPS payment pagination limit reached");
    },
    createPayment: (body: PaymentRequest) => request("/payment", body),
    resolve: (blockchainIdentifier: string) => request("/payment/resolve-blockchain-identifier", { network: "Preprod", blockchainIdentifier, includeHistory: "true" }),
    submitResult: (blockchainIdentifier: string, hash: string) => request("/payment/submit-result", { network: "Preprod", blockchainIdentifier, submitResultHash: hash }),
  };
}
export type MpsClient = ReturnType<typeof createMpsClient>;
