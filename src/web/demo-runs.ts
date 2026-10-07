import { RunTranscriptSchema, type RunTranscript } from "../orchestrator/transcript";

export function parseDemoRun(value: unknown, scenario: RunTranscript["scenario"]): RunTranscript {
  const file = `public/demo-runs/${scenario.toLowerCase()}.json`;
  const result = RunTranscriptSchema.safeParse(value);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".") || "root").join(", ");
    throw new Error(`Invalid demo transcript ${file}: ${fields}`);
  }
  if (result.data.scenario !== scenario) throw new Error(`Invalid demo transcript ${file}: expected scenario ${scenario}`);
  return result.data;
}
