import fixture from "../../../../src/web/fixtures/store-mandate.json";
import { MandateBundleSchema } from "../../../../src/guard";
import { handleStoreCheck } from "../../../../src/web/store-check";

export const runtime = "nodejs";
const bundle = MandateBundleSchema.parse(fixture);
export async function POST(request: Request) { return handleStoreCheck(request, bundle); }
