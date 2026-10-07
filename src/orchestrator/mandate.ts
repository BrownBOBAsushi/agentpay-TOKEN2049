import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { Address, COSE, KeyHash, PrivateKey } from "@evolution-sdk/evolution";
import { jcs, mandateDigest, parseMandate, verifyMandate, type MandateBundle } from "../guard";
import { isPreprodBech32Address } from "../guard/bech32";

export function createDevMandate(options: { payee: string; amount: string; minutes?: number }): MandateBundle {
  const minutes = options.minutes ?? 60;
  if (!isPreprodBech32Address(options.payee) || !Number.isSafeInteger(minutes) || minutes < 1) throw new Error("Invalid test Mandate options");
  // A fresh test key signs this Mandate only. Never save or print its private bytes.
  const key = PrivateKey.fromBytes(randomBytes(32));
  const addressHex = `60${KeyHash.toHex(KeyHash.fromPrivateKey(key))}`;
  const payerAddress = Address.toBech32(Address.fromHex(addressHex));
  const mandate = parseMandate({ v: 1, network: "cardano:preprod", payer: payerAddress, payee: options.payee,
    asset: "lovelace", amount: options.amount, expiry: Math.floor(Date.now() / 1000) + minutes * 60,
    nonce: randomBytes(16).toString("hex"), purpose: "Buy market data (test-key Mandate)" });
  const signed = COSE.SignData.signData(addressHex, Buffer.from(jcs(mandate), "utf8"), key);
  const bundle = { mandate, payerAddress, digest: mandateDigest(mandate),
    coseSign1: Buffer.from(signed.signature).toString("hex"), coseKey: Buffer.from(signed.key).toString("hex") };
  if (!verifyMandate(bundle).ok) throw new Error("Test Mandate verification failed");
  return bundle;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { payee: { type: "string" }, amount: { type: "string" }, minutes: { type: "string" } } });
    const bundle = createDevMandate({ payee: values.payee ?? "", amount: values.amount ?? "", minutes: Number(values.minutes ?? 60) });
    const path = join("runs", `mandate-${new Date().toISOString().replaceAll(":", "-")}.json`);
    await mkdir("runs", { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify(bundle, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    console.log(`${path}\nMandate digest: ${bundle.digest}`);
  } catch {
    console.error("Test Mandate failed. Use --payee <preprod address> --amount <lovelace> [--minutes 60].");
    process.exitCode = 1;
  }
}
