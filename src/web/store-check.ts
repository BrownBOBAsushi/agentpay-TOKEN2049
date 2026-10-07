import { guardCheck } from "../guard";
import type { MandateBundle } from "../guard";
import { runStoreAgent } from "./store-agent";
import { StoreRequestSchema } from "./store-contract";

export async function handleStoreCheck(request: Request, bundle: MandateBundle): Promise<Response> {
  let body: unknown;
  try { body = await request.json(); } catch { body = null; }
  const parsed = StoreRequestSchema.safeParse(body);
  const headers = { "Cache-Control": "no-store" };
  if (!parsed.success) return Response.json({ error: "Send injection as a string of at most 500 characters, or null." }, { status: 400, headers });
  const agent = runStoreAgent(parsed.data.injection, bundle.mandate.payee);
  const result = guardCheck({ bundle, proposal: agent.proposal }, { nowSec: Math.floor(Date.now() / 1000), nonceUsed: false });
  const { payee, amount, asset, expiry, purpose, payer } = bundle.mandate;
  return Response.json({ ...agent, steps: [...agent.steps, `Real Guard Check: ${result.verdict}`], ...result,
    mandate: { payee, amount, asset, expiry, purpose, payer } }, { headers });
}
