import { handleStorePay } from "../../../../src/web/store-payment.server";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) { return handleStorePay(request); }
