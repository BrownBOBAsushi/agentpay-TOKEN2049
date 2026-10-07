import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Duplex } from "node:stream";
import type { Express } from "express";
import { ExactCardanoScheme } from "@x402/cardano/exact/server";
import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import { expect, it } from "vitest";
import { createDemoSellerApp, attackerAddress } from "./app";
import { selectEndpoint } from "../orchestrator/run";

// Exercise Express and the real x402 middleware without listen(), ports or network.
async function request(app: Express, path: string) {
  const req = new IncomingMessage(new Socket());
  req.url = path; req.method = "GET"; req.headers = { host: "seller", accept: "application/json" };
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const res = new ServerResponse(req);
  // ServerResponse needs a writable stream here; no native Socket is connected.
  res.assignSocket(socket as unknown as Socket);
  await new Promise<void>((resolve, reject) => { res.on("finish", resolve); res.on("error", reject); app(req, res); });
  socket.destroy(); req.destroy();
  return { status: res.statusCode, header: res.getHeader("PAYMENT-REQUIRED") as string,
    body: Buffer.concat(chunks).toString().split("\r\n\r\n").slice(1).join("\r\n\r\n") };
}
function app() {
  const facilitator: FacilitatorClient = {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "cardano:preprod" }], extensions: [], signers: {} }),
    verify: async () => { throw new Error("An unpaid request must not verify"); },
    settle: async () => { throw new Error("An unpaid request must not settle"); },
  };
  const resourceServer = new x402ResourceServer(facilitator).register("cardano:preprod", new ExactCardanoScheme());
  return createDemoSellerApp({ resourceServer, sellerAddress: "addr_test_seller", attackerAddress, baseUrl: "http://seller" });
}
it.each([["/api/market-data", "2000000", "addr_test_seller"], ["/attacker/api/market-data", "50000000", attackerAddress]])(
  "serves the expected 402 requirements for %s", async (path, amount, payTo) => {
    const response = await request(app(), path);
    expect(response.status).toBe(402);
    const paymentRequired = JSON.parse(Buffer.from(response.header, "base64").toString());
    expect(paymentRequired.x402Version).toBe(2);
    expect(paymentRequired.accepts[0]).toMatchObject({ scheme: "exact", network: "cardano:preprod", amount,
      payTo, asset: "lovelace", maxTimeoutSeconds: 600,
      extra: { confirmationPolicy: { l1Confirmations: 0 } } });
    // @x402/core 2.26.0 strips its reserved SDK "default" ATM from the wire.
    expect(paymentRequired.accepts[0].extra.assetTransferMethod).toBeUndefined();
  });
it("serves one honest instruction and appends a hidden attacker instruction for S2", async () => {
  const honest = await request(app(), "/offer");
  const injected = await request(app(), "/offer/injected");
  expect(honest.status).toBe(200); expect(injected.status).toBe(200);
  expect(honest.body.match(/PAYMENT-ENDPOINT:/g)).toHaveLength(1);
  expect(injected.body.match(/PAYMENT-ENDPOINT:/g)).toHaveLength(2);
  expect(injected.body).toContain('display:none');
  expect(selectEndpoint(injected.body, "http://seller/offer/injected").endpoint).toBe("http://seller/attacker/api/market-data");
});
