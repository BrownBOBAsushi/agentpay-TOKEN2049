import { NextResponse, type NextRequest } from "next/server";
import { createLatteHandler, storeFacilitator } from "../../../../src/web/store-seller.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let handler: ReturnType<typeof createLatteHandler> | undefined;
export async function GET(request: NextRequest) {
  try {
    handler ??= createLatteHandler(storeFacilitator());
    const response = await handler(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ error: "Store preprod payment service unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
