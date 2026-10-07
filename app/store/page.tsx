import type { Metadata } from "next";
import { MandateBundleSchema } from "../../src/guard";
import fixture from "../../src/web/fixtures/store-mandate.json";
import testFixture from "../../src/guard/fixtures/bundle.valid.json";
import { StoreClient } from "../../src/web/StoreClient";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "The Corner Store · AgentPay Guard" };
const bundle = MandateBundleSchema.parse(fixture);
export default function StorePage() {
  return <><a className="skip-link" href="#corner-store">Skip to the store</a><main id="corner-store">
    <StoreClient bundle={bundle} testKey={bundle.coseKey === testFixture.coseKey} />
  </main></>;
}
