import { storeHire } from "../../../../../src/web/store-hire-instance.server";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  return storeHire.status((await context.params).taskId, request.headers.get("x-store-task-token"), request.headers.get("x-store-proposal-digest"));
}
