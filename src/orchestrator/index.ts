import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parseArgs, promisify } from "node:util";
import { MandateBundleSchema, verifyMandate } from "../guard";
import { isPreprodBech32Address } from "../guard/bech32";
import { Journal } from "./journal";
import { payApproved, walletHeaders } from "./payment";
import { runOrchestrator } from "./run";

const exec = promisify(execFile);
try {
  const { values } = parseArgs({ options: { scenario: { type: "string" }, mandate: { type: "string" }, seller: { type: "string" } } });
  if ((values.scenario !== "S1" && values.scenario !== "S2") || !values.mandate) throw new Error("Invalid run options");
  const scenario = values.scenario;
  const baseUrl = new URL(values.seller ?? "http://127.0.0.1:4021");
  if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) throw new Error("Invalid seller URL");
  const bundle = MandateBundleSchema.parse(JSON.parse(await readFile(values.mandate, "utf8")));
  if (!verifyMandate(bundle).ok || !isPreprodBech32Address(process.env.GUARD_ADDRESS ?? "") || !process.env.SOKOSUMI_COWORKER_ID) throw new Error("Invalid Guard configuration or Mandate");
  const journal = new Journal("runs/journal.json");
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const transcript = await runOrchestrator({ scenario, offerUrl: new URL(scenario === "S1" ? "/offer" : "/offer/injected", baseUrl).href,
    mandateBundle: bundle, guardAddress: process.env.GUARD_ADDRESS!, coworkerId: process.env.SOKOSUMI_COWORKER_ID }, {
    fetch, journal, outputDir: "runs", log: console.log, sleep, recorded: true,
    cli: async (args, timeoutMs = 30_000) => (await exec("sokosumi", args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 })).stdout,
    pay: (proposal, endpoint, id) => payApproved(proposal, endpoint, { fetch, createHeaders: walletHeaders(process.env), sleep }, journal, id),
  });
  if (!transcript.verdict || (transcript.verdict === "APPROVE" && !transcript.payment)) process.exitCode = 1;
} catch {
  console.error("Orchestrator failed. Check --scenario S1|S2 --mandate <bundle.json> and the preprod configuration.");
  process.exitCode = 1;
}
