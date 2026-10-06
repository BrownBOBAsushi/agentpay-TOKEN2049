import { z } from "zod";
import { preprodOrigin } from "./config";
import { SafeToRetryError } from "./store";

const taskSchema = z.object({ id: z.string().min(1), status: z.string(), description: z.string().nullable(), coworkerId: z.string().nullable().optional() });
export type CoreTask = z.infer<typeof taskSchema>;
export type TaskEvent = { status: "RUNNING" | "COMPLETED"; comment?: string };

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
      throw new Error(`Core ${method} transport failed`);
    }
    if (!response.ok) {
      if (method === "GET" && response.status >= 400 && response.status < 500) {
        throw new SafeToRetryError(`Core GET HTTP ${response.status}`);
      }
      throw new Error(`Core ${method} HTTP ${response.status}`);
    }
    if (method === "POST") return null;
    return response.json();
  }
  return {
    async me(): Promise<unknown> { return z.object({ data: z.unknown() }).parse(await request("/v1/coworkers/me")).data; },
    async listReadyTasks(coworkerId: string): Promise<CoreTask[]> {
      const tasks: CoreTask[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const query = new URLSearchParams({ coworkerId, status: "READY" });
        if (cursor) query.set("cursor", cursor);
        const page = z.object({ data: z.array(taskSchema), meta: z.object({ pagination: z.object({ nextCursor: z.string().nullable().optional() }).optional() }).optional() })
          .parse(await request(`/v1/tasks?${query}`));
        tasks.push(...page.data);
        cursor = page.meta?.pagination?.nextCursor ?? undefined;
        if (cursor && cursors.has(cursor)) throw new Error("Core pagination repeated a cursor");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      return tasks;
    },
    async getTask(id: string): Promise<CoreTask> {
      return z.object({ data: taskSchema }).parse(await request(`/v1/tasks/${encodeURIComponent(id)}`)).data;
    },
    async postEvent(id: string, body: TaskEvent): Promise<void> {
      await request(`/v1/tasks/${encodeURIComponent(id)}/events`, body);
    },
  };
}
export type CoreClient = ReturnType<typeof createCoreClient>;
