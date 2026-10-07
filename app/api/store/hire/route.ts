import { storeHire } from "../../../../src/web/store-hire-instance.server";

export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) { return storeHire.hire(request); }
