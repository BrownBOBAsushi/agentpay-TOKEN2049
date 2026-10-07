import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { ExactCardanoScheme } from "@x402/cardano/exact/server";
import { isPreprodBech32Address } from "../guard/bech32";
import { createDemoSellerApp, attackerAddress } from "./app";

try {
  const sellerAddress = process.env.DEMO_SELLER_ADDRESS ?? "";
  const port = Number(process.env.DEMO_SELLER_PORT || 4021);
  const url = process.env.X402_FACILITATOR_URL || "https://x402.preprod.dev.ecosyseng.cf-deployments.org";
  if (!isPreprodBech32Address(sellerAddress) || !Number.isInteger(port) || port < 1 || port > 65535
    || url !== "https://x402.preprod.dev.ecosyseng.cf-deployments.org") throw new Error("Invalid demo seller configuration");
  const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url }))
    .register("cardano:preprod", new ExactCardanoScheme());
  // Fail before listen if the facilitator cannot support the paid routes.
  await resourceServer.initialize();
  createDemoSellerApp({ resourceServer, sellerAddress, attackerAddress, baseUrl: `http://127.0.0.1:${port}` })
    .listen(port, "127.0.0.1", () => console.log(`Demo seller: http://127.0.0.1:${port}`));
} catch {
  console.error("Demo seller failed. Check the preprod configuration and facilitator.");
  process.exitCode = 1;
}
