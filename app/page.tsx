import Link from "next/link";
import { Cheque } from "../src/web/Cheque";
import { LandingScene } from "../src/web/LandingScene";
import { Stamp } from "../src/web/Stamp";
import { landingBundle, landingProposal, landingVerdict, presentedDigest } from "../src/web/landing";

export const dynamic = "force-static";
const verdict = landingVerdict(Math.floor(Date.now() / 1000));

export default function Home() {
  const repo = process.env.NEXT_PUBLIC_REPO_URL;
  const listing = process.env.NEXT_PUBLIC_SOKOSUMI_LISTING_URL;
  return <>
    <a className="skip-link" href="#presented">Skip to the Guard Check</a>
    <main>
      <section className="opening desk-opening" aria-label="The signed Mandate">
        <div className="desk-promise"><span className="desk-brand">AgentPay Guard</span><h1>An agent can only spend<br className="desktop-break" /> what its human signed.</h1></div>
        <div className="opening-paper"><Cheque bundle={landingBundle} tilt={-1.2} heading={null} /></div>
        <nav className="desk-actions" aria-label="Get started"><Link className="primary-link" href="/mandate">Sign a Mandate</Link><Link className="secondary-link" href="/receipt/01a10ff9-5009-73d6-903e-7a5effdb30d0">Read a real refusal</Link></nav>
      </section>
      <LandingScene reasons={verdict.reasons}
        signed={<Cheque bundle={landingBundle} tilt={-1.2} heading={null} />}
        presented={<Cheque bundle={landingBundle} tilt={2.5} patternDigest={presentedDigest}
          presented={{ payee: landingProposal.requirements.payTo, amount: landingProposal.requirements.amount }}
          heading={<h3>The presented copy</h3>} pencilRings stamp={<Stamp reasons={verdict.reasons} />} />} />

      <section className="endorsements" aria-labelledby="endorsements-title">
        <div className="endorsement-heading"><h2 id="endorsements-title">The back of<br />the cheque.</h2><p>From signed intent to a signed Guard Receipt.</p></div>
        <ol className="endorsement-list">
          <li><span className="endorsement-number value">1</span><div><h3>Signed by the human’s wallet.</h3><p>The Mandate carries a CIP-8 signature.</p></div></li>
          <li><span className="endorsement-number value">2</span><div><h3>Presented by the agent.</h3><p>An x402 payment becomes the Spend Proposal.</p></div></li>
          <li><span className="endorsement-number value">3</span><div><h3>Cleared or returned by the Guard.</h3><p>The Guard Receipt hash is anchored on Cardano.</p><div className="outcome-marks"><div><Stamp variant="cleared" /><span>matching proposal</span></div><div><Stamp /><span>forged proposal</span></div></div><a className="proof-link" href="https://preprod.cardanoscan.io/transaction/a3609fa45c44de6a85e8d1bec40d0d6844da5129e25f5ee27ac0c7c9747f5c32">Read the real result transaction</a></div></li>
        </ol>
      </section>
    </main>
    <footer><span>Cardano preprod · test funds only</span><nav aria-label="Project links">{repo && <a href={repo}>GitHub</a>}{listing && <a href={listing}>Sokosumi listing</a>}</nav></footer>
  </>;
}
