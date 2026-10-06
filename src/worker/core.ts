import { z } from "zod";
import { preprodOrigin } from "./config";
import { SafeToRetryError } from "./store";
import { WorkerError } from "./errors";

const taskSchema = z.object({ id: z.string().min(1), status: z.string(), description: z.string().nullable(), coworkerId: z.string().nullable().optional() });
export type CoreTask = z.infer<typeof taskSchema>;
export type TaskEvent = { status: "RUNNING" | "COMPLETED"; comment?: string }
  | { comment: string; masumiPayment: Record<string, unknown> };

function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new WorkerError("Core returned invalid response");
  return result.data;
}

export function createCoreClient(options: { origin: string; apiKey: string; fetch: typeof fetch }) {
  const origin = preprodOrigin(options.origin);
  async function request(path: string, body?: TaskEvent): Promise<unknown> {
    const method = body ? "POST" : "GET";
    let response: Response;
    try {
      response = await options.fetch(new URL(path, origin), {
        method, headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        redirect: "error", signal: AbortSignal.timeout(30_000),
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new WorkerError(`Core ${method} transport failed`);
    }
    if (!response.ok) {
      if (method === "GET" && response.status >= 400 && response.status < 500) {
        throw new SafeToRetryError(`Core GET HTTP ${response.status}`);
      }
      throw new WorkerError(`Core ${method} HTTP ${response.status}`);
    }
    if (method === "POST") return null;
    try {
      return await response.json();
    } catch {
      // Decode errors can quote response bytes; do not retain the original cause.
      throw new WorkerError(`Core returned invalid JSON (HTTP ${response.status})`);
    }
  }
  return {
    request,
    async me(): Promise<unknown> { return parseResponse(z.object({ data: z.unknown() }), await request("/v1/coworkers/me")).data; },
    async listReadyTasks(coworkerId: string): Promise<CoreTask[]> {
      const tasks: CoreTask[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const query = new URLSearchParams({ coworkerId, status: "READY" });
        if (cursor) query.set("cursor", cursor);
        const page = parseResponse(z.object({ data: z.array(taskSchema), meta: z.object({ pagination: z.object({ nextCursor: z.string().nullable().optional() }).optional() }).optional() }),
          await request(`/v1/tasks?${query}`));
        tasks.push(...page.data);
        cursor = page.meta?.pagination?.nextCursor ?? undefined;
        if (cursor && cursors.has(cursor)) throw new WorkerError("Core pagination repeated a cursor");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return tasks;
    },
    async getTask(id: string): Promise<CoreTask> {
      return parseResponse(z.object({ data: taskSchema }), await request(`/v1/tasks/${encodeURIComponent(id)}`)).data;
    },
    async postEvent(id: string, body: TaskEvent): Promise<void> {
      await request(`/v1/tasks/${encodeURIComponent(id)}/events`, body);
    },
    async receipt(id: string): Promise<{ settled: boolean; txHash?: string | null }> {
      return parseResponse(z.object({ data: z.object({ settled: z.boolean(), txHash: z.string().nullable().optional() }) }),
        await request(`/v1/tasks/${encodeURIComponent(id)}/receipt`)).data;
    },
  };
}
export type CoreClient = ReturnType<typeof createCoreClient>;
