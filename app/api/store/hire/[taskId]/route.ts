import { storeHire } from "../../../../../src/web/store-hire-instance.server";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  return storeHire.status((await context.params).taskId);
}
