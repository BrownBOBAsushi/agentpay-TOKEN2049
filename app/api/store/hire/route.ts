import { storeHire } from "../../../../src/web/store-hire-instance.server";

export const runtime = "nodejs";
export async function POST(request: Request) { return storeHire.hire(request); }
