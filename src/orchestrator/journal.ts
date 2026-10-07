import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { PaymentSchema } from "./transcript";

export class StopError extends Error {}
const actionSchema = z.object({ state: z.enum(["signing", "prepared", "done"]),
  headers: z.record(z.string(), z.string()).optional(), payment: PaymentSchema.optional(),
  endpoint: z.string().optional(), proposalDigest: z.string().optional(), txHash: z.string().regex(/^[0-9a-f]{64}$/).optional() });
const journalSchema = z.object({ v: z.literal(1),
  hires: z.record(z.string(), z.object({ taskId: z.string().optional() })),
  actions: z.record(z.string(), actionSchema) });
type Action = z.infer<typeof actionSchema>;
export type ActionId = { taskId: string; eventId: string; action: "hire" | "pay" };
const actionKey = (id: ActionId) => JSON.stringify([id.taskId, id.eventId, id.action]);

export class Journal {
  constructor(readonly path: string) {}
  private async read(): Promise<z.infer<typeof journalSchema>> {
    try { return journalSchema.parse(JSON.parse(await readFile(this.path, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { v: 1, hires: {}, actions: {} };
      throw new StopError("journal invalid; stop to prevent duplicate side effects");
    }
  }
  private async save(data: z.infer<typeof journalSchema>) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(`${this.path}.tmp`, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    await rename(`${this.path}.tmp`, this.path);
  }
  async getHire(requestKey: string) { return (await this.read()).hires[requestKey]; }
  async setHire(requestKey: string, taskId?: string) {
    const data = await this.read(); data.hires[requestKey] = taskId ? { taskId } : {}; await this.save(data);
  }
  async get(id: ActionId) { return (await this.read()).actions[actionKey(id)]; }
  async getPaymentId(taskId: string): Promise<ActionId | undefined> {
    const keys = Object.keys((await this.read()).actions).map((key) => {
      try { return z.tuple([z.string(), z.string(), z.enum(["hire", "pay"])]).parse(JSON.parse(key)); }
      catch { throw new StopError("journal action key invalid; no payment"); }
    }).filter(([task, , action]) => task === taskId && action === "pay");
    if (keys.length > 1) throw new StopError("Task has multiple saved payments; stop for inspection");
    return keys[0] ? { taskId, eventId: keys[0][1], action: "pay" } : undefined;
  }
  async set(id: ActionId, action: Action) {
    const data = await this.read(); data.actions[actionKey(id)] = action; await this.save(data);
  }
  async withLock<T>(work: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    // ponytail: one demo run per journal; use per-wallet locks if parallel runs are required.
    let lock;
    try { lock = await open(`${this.path}.lock`, "wx", 0o600); }
    catch { throw new StopError("journal locked; another run or an interrupted run needs inspection"); }
    try { return await work(); }
    finally { await lock.close(); await unlink(`${this.path}.lock`); }
  }
}
