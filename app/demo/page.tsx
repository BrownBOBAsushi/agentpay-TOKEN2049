import type { Metadata } from "next";
import Link from "next/link";
import s1 from "../../public/demo-runs/s1.json";
import s2 from "../../public/demo-runs/s2.json";
import { parseDemoRun } from "../../src/web/demo-runs";
import { DemoArena } from "../../src/web/DemoArena";
import styles from "../../src/web/demo.module.css";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Demo arena · AgentPay Guard" };
// Module evaluation validates both files during the build, before either reaches the browser.
const runs = { S1: parseDemoRun(s1, "S1"), S2: parseDemoRun(s2, "S2") };

export default function DemoPage() {
  return <>
    <a className="skip-link" href="#demo-runs">Skip to the demo runs</a>
    <main className={styles.page}>
      <header className={styles.header}><Link href="/" className="desk-brand">AgentPay Guard</Link>
        <h1>Two offers.<br />One signed intent.</h1>
        <p>Read the offer. Follow the Guard Check. Compare the outcome.</p><Link href="/store">Try the attack</Link>
      </header>
      <div id="demo-runs"><DemoArena runs={runs} /></div>
    </main>
    <footer><span>Cardano preprod · test funds only</span><Link href="/mandate">Sign a Mandate</Link></footer>
  </>;
}
