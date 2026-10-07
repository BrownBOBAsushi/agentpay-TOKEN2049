import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { verifyReceipt, proposalDigest, type MandateBundle, type SignedReceipt, type SpendProposal } from "../guard";
import { Journal, StopError, type ActionId } from "./journal";
import { readProposal, type Fetch } from "./payment";
import { RunTranscriptSchema, type RunTranscript, type Payment } from "./transcript";

export type CliRunner = (args: string[], timeoutMs?: number) => Promise<string>;
const terminalEventSchema = z.object({ id: z.string().min(1), taskId: z.string().min(1),
  status: z.enum(["COMPLETED", "FAILED"]), comment: z.string().nullable() });

export function selectEndpoint(html: string, offerUrl: string) {
  // Deliberately naive: hidden page instructions have the same weight as visible text.
  const lines = [...html.matchAll(/PAYMENT-ENDPOINT:[ \t]*([^\s<]+)/g)];
  const last = lines.at(-1);
  if (!last) throw new StopError("payment instruction missing");
  const endpoint = new URL(last[1], offerUrl);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new StopError("invalid demo payment endpoint");
  }
  const instruction = `PAYMENT-ENDPOINT: ${last[1]}`;
  return { endpoint: endpoint.href, instruction, injectedExcerpt: lines.length > 1 ? instruction : null };
}

export function taskIdFromCreate(output: string): string {
  const parsed = z.object({ id: z.string().optional(), task: z.object({ id: z.string() }).optional(),
    data: z.object({ id: z.string() }).optional() }).parse(JSON.parse(output));
  const id = parsed.id ?? parsed.task?.id ?? parsed.data?.id;
  if (!id?.trim()) throw new StopError("task create returned no id; do not hire again");
  return id;
}

async function pollTask(taskId: string, cli: CliRunner, sleep: (ms: number) => Promise<void>) {
  const timeoutAt = Date.now() + 180_000;
  while (Date.now() < timeoutAt) {
    let output: string;
    try { output = await cli(["--preprod", "tasks", "events", taskId, "--json"], Math.min(30_000, timeoutAt - Date.now())); }
    catch (error) {
      if (Date.now() >= timeoutAt) throw new StopError("Guard Task timed out; no payment");
      throw error;
    }
    if (Date.now() >= timeoutAt) throw new StopError("Guard Task timed out; no payment");
    const response = z.object({ events: z.array(z.unknown()) }).parse(JSON.parse(output));
    for (const raw of [...response.events].reverse()) {
      const parsed = terminalEventSchema.safeParse(raw);
      if (parsed.success && parsed.data.taskId === taskId) return parsed.data;
    }
    await sleep(Math.min(3000, timeoutAt - Date.now()));
  }
  throw new StopError("Guard Task timed out; no payment");
}

export async function runOrchestrator(options: {
  scenario: "S1" | "S2"; offerUrl: string; mandateBundle: MandateBundle; guardAddress: string; coworkerId: string;
}, deps: { fetch: Fetch; cli: CliRunner; journal: Journal; outputDir: string; log: (line: string) => void;
  sleep?: (ms: number) => Promise<void>; recorded?: boolean;
  pay: (proposal: SpendProposal, endpoint: string, id: ActionId) => Promise<Payment>;
}): Promise<RunTranscript> {
  const transcript: RunTranscript = { v: 1, scenario: options.scenario, recorded: deps.recorded ?? false,
    startedAt: new Date().toISOString(), offerUrl: options.offerUrl, injectedExcerpt: null, steps: [],
    taskId: null, verdict: null, reasons: [], diff: [], payment: null };
  const step = (kind: RunTranscript["steps"][number]["kind"], text: string) => {
    const at = new Date().toISOString(); transcript.steps.push({ at, kind, text }); deps.log(`${at} ${kind}: ${text}`);
  };
  try {
    await deps.journal.withLock(async () => {
      step("read-page", `Read ${options.offerUrl}`);
      const page = await deps.fetch(options.offerUrl, { redirect: "error", signal: AbortSignal.timeout(30_000) });
      if (!page.ok) throw new StopError("offer page unavailable");
      const instruction = selectEndpoint(await page.text(), options.offerUrl);
      transcript.injectedExcerpt = instruction.injectedExcerpt;
      step("instruction", instruction.instruction);
      const { proposal } = await readProposal(await deps.fetch(instruction.endpoint, { redirect: "error", signal: AbortSignal.timeout(30_000) }));
      step("payment-required", `402: ${proposal.requirements.amount} ${proposal.requirements.asset} to ${proposal.requirements.payTo}`);
      step("proposal", `Spend Proposal ${proposalDigest(proposal)}`);
      const requestKey = JSON.stringify([options.scenario, options.offerUrl, options.mandateBundle.digest, proposalDigest(proposal)]);
      let hire = await deps.journal.getHire(requestKey);
      if (hire && !hire.taskId) throw new StopError("hire interrupted; inspect the Task before hiring again");
      if (!hire) {
        await deps.journal.setHire(requestKey);
        const taskId = taskIdFromCreate(await deps.cli(["--preprod", "tasks", "create", "--personal", "--coworker-id", options.coworkerId,
          "--name", `Guard Check ${options.scenario} ${transcript.startedAt}`, "--description", JSON.stringify({ mandateBundle: options.mandateBundle, proposal }),
          "--status", "READY", "--json"]));
        await deps.journal.setHire(requestKey, taskId); hire = { taskId };
      }
      const taskId = hire.taskId!; transcript.taskId = taskId;
      step("hire", `Guard Task ${taskId}`);
      const event = await pollTask(taskId, deps.cli, deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
      await deps.journal.set({ taskId, eventId: event.id, action: "hire" }, { state: "done" });
      if (event.status === "FAILED") throw new StopError("Guard Task failed; no payment");
      step("receipt", `Guard Receipt from event ${event.id}`);
      let signed: SignedReceipt;
      try { signed = JSON.parse(event.comment ?? ""); } catch { throw new StopError("receipt not trusted"); }
      if (!verifyReceipt(signed, options.guardAddress) || signed.guardAddress !== options.guardAddress
        || signed.receipt.taskId !== taskId || signed.receipt.proposalDigest !== proposalDigest(proposal)
        || signed.receipt.mandateDigest !== options.mandateBundle.digest) throw new StopError("receipt not trusted");
      transcript.verdict = signed.receipt.verdict; transcript.reasons = signed.receipt.reasons; transcript.diff = signed.receipt.diff;
      step("verify", `Trusted Guard Receipt: ${signed.receipt.verdict}`);
      if (signed.receipt.verdict === "REFUSE") {
        step("stop", `REFUSE: ${JSON.stringify(signed.receipt.diff)}`); return;
      }
      const id: ActionId = { taskId, eventId: event.id, action: "pay" };
      const paid = await deps.journal.get(id);
      if (paid?.state === "done") {
        if (!paid.payment || paid.endpoint !== instruction.endpoint || paid.proposalDigest !== proposalDigest(proposal)) {
          throw new StopError("saved payment does not match the approved proposal and endpoint");
        }
        transcript.payment = paid.payment; step("stop", "Payment already done; no second payment"); return;
      }
      if (Math.floor(Date.now() / 1000) + proposal.requirements.maxTimeoutSeconds > options.mandateBundle.mandate.expiry) {
        throw new StopError("Mandate expires before payment deadline; no payment");
      }
      step("pay", "Check fresh requirements, then pay the approved proposal");
      transcript.payment = await deps.pay(proposal, instruction.endpoint, id);
      // The injected payer has the same journal contract as the real payer.
      await deps.journal.set(id, { state: "done", payment: transcript.payment, endpoint: instruction.endpoint, proposalDigest: proposalDigest(proposal) });
      step("paid", `${transcript.payment.status}: ${transcript.payment.txHash}`);
    });
  } catch (error) {
    // SDK/CLI errors can contain credential or command data. Print controlled errors only.
    step("stop", error instanceof StopError ? error.message : "Run stopped; payment outcome may be unknown. Check configuration and saved journal.");
  }
  const parsed = RunTranscriptSchema.parse(transcript);
  await mkdir(deps.outputDir, { recursive: true, mode: 0o700 });
  await writeFile(join(deps.outputDir, `${parsed.startedAt.replaceAll(":", "-")}-${parsed.scenario}.json`), JSON.stringify(parsed, null, 2) + "\n", { mode: 0o600 });
  return parsed;
}
