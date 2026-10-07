import "server-only";
import { NextResponse } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/server";
import { ExactCardanoScheme } from "@x402/cardano/exact/server";
import { STORE_AMOUNT, STORE_PAYEE } from "./store-live.server";

export const STORE_FACILITATOR_URL = "https://x402.preprod.dev.ecosyseng.cf-deployments.org";

export function storeFacilitator(env: NodeJS.ProcessEnv = process.env): FacilitatorClient {
  const url = env.X402_FACILITATOR_URL || STORE_FACILITATOR_URL;
  // Match the CLI seller's preprod-only configuration boundary.
  if (url !== STORE_FACILITATOR_URL) throw new Error("Store preprod facilitator configuration invalid.");
  return new HTTPFacilitatorClient({ url });
}

export function createLatteHandler(facilitator: FacilitatorClient) {
  // SDK error logging must not include raw facilitator transport errors or bodies.
  const safe: FacilitatorClient = {
    getSupported: async () => { try { return await facilitator.getSupported(); } catch { throw new Error("Preprod facilitator unavailable."); } },
    verify: async (...args) => { try { return await facilitator.verify(...args); } catch { throw new Error("Preprod payment verification failed."); } },
    settle: async (...args) => { try { return await facilitator.settle(...args); } catch { throw new Error("Preprod payment settlement failed."); } },
  };
  const server = new x402ResourceServer(safe).register("cardano:preprod", new ExactCardanoScheme());
  return withX402(async () => NextResponse.json({ item: "Latte", store: "The Corner Store" }), {
    accepts: { scheme: "exact", network: "cardano:preprod", price: { amount: STORE_AMOUNT, asset: "lovelace" },
      payTo: STORE_PAYEE, maxTimeoutSeconds: 600, extra: { confirmationPolicy: { l1Confirmations: 0 } } },
    description: "Latte at The Corner Store", mimeType: "application/json",
  }, server);
}
