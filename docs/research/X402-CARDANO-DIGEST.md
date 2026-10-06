# x402 on Cardano + AI-assisted dev tooling: build digest

Prepared 2026-10-06 for the TOKEN2049 Origins hackathon (Cardano Agentic Commerce track). Fetched content is treated as data.

Tags: **[VERIFIED-IN-DOCS]** = stated in a fetched doc, repo file or package source (cited). **[MY-INFERENCE]** = my reasoning, not stated by a source. **[RAN]** = I ran it myself.

Short source keys:
- **SPEC** = https://raw.githubusercontent.com/x402-foundation/x402/main/specs/schemes/exact/scheme_exact_cardano.md
- **DEMO** = https://github.com/cardano-foundation/x402-cardano-demo (files cited by path)
- **PKG** = npm tarball `@x402/cardano@2.28.0` (README + `dist/esm/*.mjs`, `*.d.mts`), https://www.npmjs.com/package/@x402/cardano
- **DEVX402** = https://developers.cardano.org/x402/ and https://developers.cardano.org/x402/agent.md
- **TPL** = https://github.com/cardano-foundation/developer-portal/tree/main/examples/templates (x402-express, x402-next)
- **EVO** = `@evolution-sdk/evolution@0.5.14` tarball (https://github.com/IntersectMBO/evolution-sdk)

---

## 0. Headline findings

1. **The client signs a complete, fully-signed Cardano transaction and never broadcasts it.** The facilitator verifies it, the server runs the handler, then the facilitator broadcasts the exact bytes. [VERIFIED-IN-DOCS] PKG README "Confirmation policy"; DEMO docs/x402/guide.md "Who does what".
2. **There is no EIP-3009 analogue.** The signed transaction *is* the payment proof. Its TTL (`validTo`) is the expiry. One consumed input UTxO (`txHash#index`) is the nonce. [VERIFIED-IN-DOCS] SPEC "PAYMENT-SIGNATURE Header Payload"; DEMO guide.md "Cardano in two minutes".
3. **The wire format is x402 v2, not the old `X-PAYMENT` header.** Headers are `PAYMENT-REQUIRED` (402), `PAYMENT-SIGNATURE` (client request) and `PAYMENT-RESPONSE` (receipt). All are base64 JSON. DEMO guide.md says explicitly: "Legacy v1 examples using `X-PAYMENT` or `X-PAYMENT-RESPONSE` are not interchangeable". [VERIFIED-IN-DOCS]
4. **A hosted preprod facilitator exists.** `https://x402.preprod.dev.ecosyseng.cf-deployments.org` [VERIFIED-IN-DOCS] DEVX402 and TPL `.env.example`. [RAN] `GET /supported` returned 200 on 2026-10-06 (see 4).
5. **x402 can pay into Masumi escrow.** The `masumi` asset-transfer method locks funds in Masumi's `vested_pay` V2 contract with a 19-field inline datum. The `script` method locks into any contract with an arbitrary inline datum. [VERIFIED-IN-DOCS] SPEC, PKG README. There is an important caveat (section 8).

---

## 1. Flow, step by step

Cardano exact scheme, `default` method (address to address).

1. **Client:** `GET /api/message`.
2. **Server:** HTTP `402` with header `PAYMENT-REQUIRED` = base64(JSON `PaymentRequired`). [VERIFIED-IN-DOCS] DEMO README "Follow one payment".

   Decoded shape (DEMO docs/x402/guide.md; SPEC; DEMO docs/x402/reference.agent.md TYPES):
   ```json
   {
     "x402Version": 2,
     "error": "PAYMENT-SIGNATURE header is required",
     "resource": { "url": "http://localhost:4021/api/message", "description": "...", "mimeType": "application/json" },
     "accepts": [{
       "scheme": "exact",
       "network": "cardano:preprod",
       "amount": "2000000",
       "asset": "lovelace",
       "payTo": "addr_test1...",
       "maxTimeoutSeconds": 600,
       "extra": {
         "assetTransferMethod": "default",
         "areFeesSponsored": false,
         "confirmationPolicy": { "l1Confirmations": 1 }
       }
     }]
   }
   ```
   - `amount` is a positive decimal string in atomic units.
   - `asset` is `"lovelace"` or `"<policyId>.<assetNameHex>"`.
   - `extra.assetTransferMethod` is `default`, `masumi` or `script`.
   - `extra.areFeesSponsored` is always `false`: **the payer pays the fee**.
   - `confirmationPolicy.l1Confirmations` is -1..20. Default 1. -1 = facilitator broadcast accepted, 0 = in a block, N = N newer blocks. [VERIFIED-IN-DOCS] SPEC; PKG README.
3. **Client:** picks an offer, then **builds and signs a full Cardano tx** that:
   - spends a wallet UTxO that serves as the **nonce**;
   - pays `amount` of `asset` to `payTo`;
   - sets `validTo` (TTL) to about `now + maxTimeoutSeconds`;
   - returns change to the payer.
   [VERIFIED-IN-DOCS] DEMO frontend/src/x402/cip30Signer.ts; PKG `dist/esm/index.mjs` around line 430.
4. **Client retries** the same GET with `PAYMENT-SIGNATURE` = base64 of the whole `PaymentPayload` (not a raw signature):
   ```json
   { "x402Version": 2,
     "resource": { "url": "..." },
     "accepted": { "...the chosen accepts[] entry, copied verbatim..." },
     "payload": { "transaction": "<base64 of the FULLY SIGNED tx CBOR>", "nonce": "<txHash>#<index>" } }
   ```
   `transaction` is the **complete signed transaction CBOR** (body + witness set + isValid + auxiliaryData), base64. It is not just a body or a witness. `nonce` must be one of the tx's inputs. [VERIFIED-IN-DOCS] SPEC; DEMO reference.agent.md TYPES; PKG signer code.
5. **Server:** `POST {facilitator}/verify` with body `{paymentPayload, paymentRequirements}`. Invalid payments return **HTTP 200** with `isValid:false` and `invalidReason`. Non-2xx means transport failure only. [VERIFIED-IN-DOCS] DEVX402 agent.md gotcha 3; DEMO reference.agent.md ENDPOINTS.
6. **Server** runs the resource handler. The Express middleware buffers the response. **Handler side effects can run again on a paid retry**, so they must be idempotent. [VERIFIED-IN-DOCS] DEMO guide.md "Who does what".
7. **Server:** `POST {facilitator}/settle`. **The facilitator broadcasts the client's exact signed bytes**, then waits (default 75 s) for the confirmation policy.
   - If the evidence is insufficient, it returns `success:false, errorReason:"settlement_pending"` with the tx id.
   - `@x402/core` retries settle **once**; the facilitator resumes observation and never re-broadcasts.
   - Settlement is deduplicated by canonical tx id. [VERIFIED-IN-DOCS] PKG README "Settlement and settlement_pending".
8. **Server** returns `200` with the resource plus `PAYMENT-RESPONSE` = base64 of `{success, network, transaction, extra:{status:"confirmed"|"mempool"|"pending", confirmations}}`. [VERIFIED-IN-DOCS] SPEC "PAYMENT-RESPONSE Header Payload".

**Who submits the tx:** the facilitator, using Blockfrost (or Koios). The client never submits. The facilitator needs no keys and no funds. [VERIFIED-IN-DOCS] PKG README "Testnet funds"; DEMO guide.md.

**Facilitator checks (9 rules).** [VERIFIED-IN-DOCS] SPEC; DEMO reference.agent.md RULES:
1. network matches;
2. an output goes to `payTo`;
3. the `payTo` output has at least `amount`;
4. the asset matches exactly;
5. the nonce is a tx input and is unspent on chain;
6. phase-1: signatures valid, value conserved, fee at or above the floor. Txs that mint, withdraw or carry certificates are rejected unless the operator supplies a full validator;
7. TTL is in the future and not later than `now + maxTimeoutSeconds`;
8. min-UTxO is met;
9. confirmation evidence meets the policy.

**Assets.**
- `lovelace` (tADA): 1 ADA = 1,000,000 lovelace.
- Native tokens use `policyId.assetNameHex`.
- Default preprod tUSDM is `e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9.0014df10745553444d` (6 decimals; faucet https://tusdm.moneta.global). The export is `USDM_PREPROD_ASSET`. [VERIFIED-IN-DOCS] DEMO reference.agent.md REPO; PKG README.
- **A different tUSDM exists:** Masumi's own (policy `16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde`, from https://dispenser.masumi.network/). The two are different assets. [VERIFIED-IN-DOCS] DEMO README "Explore the advanced options".
- Mainnet USDM exists in `DEFAULT_ASSETS`. [VERIFIED-IN-DOCS] PKG README.

**Network config.**
- Identifiers: `cardano:mainnet`, `cardano:preprod`, `cardano:preview`.
- CIP-34 aliases are accepted: `cip34:0-1` is preprod.
- CIP-30 `getNetworkId()` returns 0 for **both** preprod and preview. A testnet address alone does not tell them apart, so the demo checks wallet UTxOs against Blockfrost preprod. [VERIFIED-IN-DOCS] PKG README "Networks"; DEMO guide.md.
- DEVX402 agent.md says "preprod only, no mainnet". The package README lists mainnet identifiers. Treat preprod as the hackathon target.

---

## 2. Packages and versions

| Package | Version | Notes |
|---|---|---|
| `@x402/cardano` | **2.28.0** is `latest` on npm (2.26.0 published 2026-09-18, 2.27.0 on 09-22, 2.28.0 on 09-29). TPL and DEMO pin **2.26.0**. | [RAN] `npm view @x402/cardano`. Deps: `@evolution-sdk/evolution ^0.5.9`, `@noble/hashes`, `lz-string`, `@x402/core ~2.28.0`. Exports `./exact/client`, `./exact/server`, `./exact/facilitator`. |
| `@x402/core` | 2.28.0 (templates pin 2.26.0) | `x402ResourceServer`, `HTTPFacilitatorClient`, `x402Client`, `x402HTTPClient`, `x402Facilitator`. |
| `@x402/express` | 2.28.0 / pinned 2.26.0 | `paymentMiddleware`. |
| `@x402/fetch` | 2.28.0 / pinned 2.26.0 | `wrapFetchWithPayment`. |
| `@x402/next` | 2.28.0 / pinned 2.26.0 | Peer deps: `next >=16.2.6`, `@x402/paywall ^2.28.0` ([RAN] `npm view @x402/next peerDependencies`). Template pins `next 16.3.6`, `react 19.2.0`. |
| `@evolution-sdk/evolution` | latest 0.5.17; templates pin **0.5.14** | Pure TS, no WASM. Transaction builder, CIP-30 client, COSE signing. |

Safest choice: **pin all `@x402/*` to the same version.** DEVX402 agent.md says "pinned to exactly 2.26.0", which is the version the templates and the facilitator are known to use. Mixing 2.26 and 2.28 is untested by me. [MY-INFERENCE] The hosted facilitator's version is unknown.

Other facts:
- Node 20.9+ for the templates, Node 22+ for the demo repo. [VERIFIED-IN-DOCS]
- A free Blockfrost **preprod** project id is needed for the client wallet's UTxO queries and for any self-run facilitator. [VERIFIED-IN-DOCS] TPL README.
- No Python or Go SDK for Cardano x402. [VERIFIED-IN-DOCS] DEVX402 agent.md gotcha 11.
- Bootstrap with `npx giget@latest gh:cardano-foundation/developer-portal/examples/templates/x402-express my-app`, or `.../x402-next`. [VERIFIED-IN-DOCS]

---

## 3. Minimal code

All code below is copied or lightly trimmed from TPL and DEMO. [VERIFIED-IN-DOCS]

### 3a. Paid server route (Express), against the hosted facilitator

Source: TPL x402-express/src/seller.ts.
```ts
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactCardanoScheme } from "@x402/cardano/exact/server";

const NETWORK = "cardano:preprod" as const;
const resourceServer = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: "https://x402.preprod.dev.ecosyseng.cf-deployments.org" }));
resourceServer.register(NETWORK, new ExactCardanoScheme());

const app = express();
app.use(paymentMiddleware({
  "GET /api/message": {
    accepts: [{ scheme: "exact", network: NETWORK,
      price: { amount: "2000000", asset: "lovelace" }, payTo: process.env.SELLER_ADDRESS! }],
    description: "A message that costs 2 tADA", mimeType: "application/json",
  },
}, resourceServer));
app.get("/api/message", (_req, res) => res.json({ message: "paid" }));
app.listen(4021);
```
Notes:
- Token price: `price: { amount: "100000", asset: USDM_PREPROD_ASSET }` (import from `@x402/cardano`).
- Per-route `extra: { assetTransferMethod:"default", confirmationPolicy:{ l1Confirmations: 0 } }` is optional. The DEMO app sets it explicitly with `maxTimeoutSeconds: 600`.
- If the server's `x402ResourceServer` cannot reach the facilitator at startup, it fails with "no supported payment kinds" (DEVX402 agent.md gotcha 5).

### 3b. Paying client with its own preprod wallet (agent side, no browser)

Source: TPL x402-express/src/buyer.ts. `npm run wallet` in the template generates a mnemonic.
```ts
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { toClientCardanoSigner } from "@x402/cardano";
import { ExactCardanoScheme } from "@x402/cardano/exact/client";

// lovelace is not USD-pegged: default spend controls REJECT it, so allow it explicitly
const client = new x402Client().setSpendControls({
  allowedAssets: [{ network: "cardano:*", asset: "lovelace", maxAmountPerPayment: "5000000" }],
});
const signer = toClientCardanoSigner({
  mnemonic: process.env.MNEMONIC!, network: "cardano:preprod",
  provider: { blockfrost: { baseUrl: "https://cardano-preprod.blockfrost.io/api/v0", projectId: process.env.BLOCKFROST_PROJECT_ID! } },
});
client.register("cardano:*", new ExactCardanoScheme(signer));
const res = await wrapFetchWithPayment(fetch, client)("http://localhost:4021/api/message");
```
- Fund the printed address from https://docs.cardano.org/cardano-testnets/tools/faucet (choose Preprod). Only the client needs funds. [VERIFIED-IN-DOCS] PKG README.
- **Spend controls** (`allowedAssets` with `maxAmountPerPayment`) are the x402 client's built-in cap. This is a useful AgentPay talking point: it is coarse, not user-signed and not per-payee. [MY-INFERENCE]
- The reference signer **drops auxiliary data**: `auxiliaryData: null` in PKG `dist/esm/index.mjs` line 454. See 6b for metadata.
- Concurrency gotcha: the signer uses the wallet's first UTxO as nonce, so **concurrent payments collide**. Use one wallet per parallel agent (DEVX402 agent.md gotcha 12). [VERIFIED-IN-DOCS]

### 3c. Browser CIP-30 paywall (Next.js)

Template: TPL x402-next. Run with `npm install; cp .env.example .env; npm run facilitator; npm run dev` (port 3002). Env: `SELLER_ADDRESS`, `FACILITATOR_URL`, `BLOCKFROST_PROJECT_ID`. Blockfrost is reached through the server-side route `app/api/blockfrost/[...path]/route.ts`, so the key stays off the browser.

Note: DEVX402 agent.md says `NEXT_PUBLIC_BLOCKFROST_PROJECT_ID`; the template's `.env.example` says server-only. This is an inconsistency between the two sources. [VERIFIED-IN-DOCS] both.

Server route (`app/api/message/route.ts`):
```ts
import { withX402 } from "@x402/next";
export const runtime = "nodejs";
export const GET = withX402(handler, {
  accepts: { scheme: "exact", network: "cardano:preprod",
             price: { amount: "1000000", asset: "lovelace" }, payTo },
  description: "A message that costs 1 tADA",
}, server);   // server = new x402ResourceServer(new HTTPFacilitatorClient({url})).register("cardano:preprod", new ExactCardanoScheme())
```
Leave `withX402`'s `syncFacilitatorOnStart` at its default; disabling it breaks route detection. [VERIFIED-IN-DOCS] DEVX402 agent.md gotcha 9.

Browser wallet signer (`lib/x402/cip30.ts`, **the file to adapt**):
```ts
import { Address, Assets, Client, Transaction, preprod } from "@evolution-sdk/evolution";
const client = Client.make(preprod).withBlockfrost(provider).withCip30(walletApi);   // walletApi = await window.cardano.eternl.enable()
// inside ClientCardanoSigner.buildAndSignPaymentTransaction(input):
const utxos = await client.getWalletUtxos();
const usable = await liveUtxos(utxos, provider);            // filter against Blockfrost preprod
const nonceInput = usable[0];
const built = await client.newTx().collectFrom({ inputs: [nonceInput] })
  .payToAddress({ address: Address.fromBech32(input.payTo), assets: assets(input.asset, BigInt(input.amount)) })
  .setValidity({ to: BigInt(Date.now() + input.maxTimeoutSeconds * 1000) })
  .build({ changeAddress: await client.address(), availableUtxos: usable, autoMinUtxo: input.asset !== "lovelace" });
const unsigned = await built.toTransaction();
const signed = await built.sign();                          // wallet returns ONLY the witness set
const tx = new Transaction.Transaction({ body: unsigned.body, witnessSet: signed.witnessSet,
                                          isValid: true, auxiliaryData: unsigned.auxiliaryData });  // <- aux data preserved here
return { transaction: Buffer.from(Transaction.toCBORBytes(tx)).toString("base64"), nonce: `${txHashHex}#${nonceInput.index}` };
```
Client loop (`lib/x402/payFlow.ts`) uses `x402Client.fromConfig({ schemes:[{network:"cardano:preprod", client:new ExactCardanoScheme(signer)}], spendControls:{ allowedAssets:[...] } })`, `x402HTTPClient.getPaymentRequiredResponse`, `createPaymentPayload`, `encodePaymentSignatureHeader`. It then re-sends the same URL with the headers and, while pending, **re-checks the same signed payment instead of building a new one**. UI component: `components/Paywall.tsx`. It lists `window.cardano.*` wallets that expose `enable()`. Eternl and Lace are named in the docs. [VERIFIED-IN-DOCS]

---

## 4. Facilitator: hosted or self-run?

- **Hosted, preprod:** `https://x402.preprod.dev.ecosyseng.cf-deployments.org`. **Hosted, mainnet:** `https://x402.mainnet.dev.ecosyseng.cf-deployments.org`. [VERIFIED-IN-DOCS] DEVX402. TPL `.env.example` defaults to the preprod URL.
- [RAN] `GET /supported` on the preprod URL (2026-10-06) returned:
  ```json
  {"kinds":[{"x402Version":2,"scheme":"exact","network":"cardano:preprod",
    "extra":{"assetTransferMethods":["default","masumi","script"],"areFeesSponsored":false,
             "l1Confirmations":{"minimum":0,"maximum":20}}}],"extensions":[],"signers":{"cardano:*":[]}}
  ```
  So it supports **default, masumi and script**, with confirmation levels 0 to 20 (not -1).
- `/health` returned 404 on the hosted one. The facilitator interface is just `POST /verify`, `POST /settle`, `GET /supported`.
- DEVX402 agent.md says "Hosted URL announced at October 6 morning session. Until then run local." That is dated on the hackathon day (today), yet the endpoint already answers. Re-check at the event; a self-run fallback is cheap.
- **Self-run (needs only a Blockfrost preprod key, no wallet or funds):**
  - `npm run facilitator` in the TPL templates (default port 4022; loopback by default), or DEMO `facilitator/src/facilitator.ts`.
  - Both wrap `new x402Facilitator().register("cardano:preprod", new ExactCardanoScheme(toFacilitatorCardanoSigner({network, provider:{blockfrost:{baseUrl, projectId}}, awaitConfirmation:false})))`.
  - Settlement dedup store is in-memory by default. [VERIFIED-IN-DOCS] PKG README.
- The **public x402.org facilitator does not support Cardano.** [VERIFIED-IN-DOCS] DEVX402 agent.md gotcha 10.

---

## 5. Gotchas

- **Min-UTxO.**
  - Every output needs ADA. A pure-lovelace price below about 1 ADA is invalid. A token output needs about 1.2-1.5 ADA of structural lovelace on top of the token. [VERIFIED-IN-DOCS] SPEC "Minimum UTXO"; DEVX402 agent.md gotcha 2 and 13.
  - Formula: `(160 + |serialized_output|) * coinsPerUtxoByte`. [VERIFIED-IN-DOCS] SPEC.
  - For sub-cent usage, sell credit packs. Template prices are 1-2 tADA or 0.10 tUSDM.
- **Fees.** The payer pays about 0.17 ADA, and `areFeesSponsored` is false. There is no fee-sponsorship path in this scheme version. [VERIFIED-IN-DOCS] DEVX402 agent.md gotcha 13; SPEC "Transaction Fees".
- **Collateral.** Only relevant to Plutus txs. The `default` method has no scripts, so no collateral is needed. The Masumi lock requires a client-computed `collateral_return_lovelace` (at least 1,435,230, or 0 when the price already covers min-UTxO after `SubmitResult`). [VERIFIED-IN-DOCS] SPEC Masumi section.
- **Preprod faucets.** ADA: https://docs.cardano.org/cardano-testnets/tools/faucet (select Preprod; preview is a separate network). tUSDM: https://tusdm.moneta.global. Masumi tUSDM: https://dispenser.masumi.network/. [VERIFIED-IN-DOCS]
- **TTL = natural expiry.**
  - The client sets `validTo` to `now + maxTimeoutSeconds` (600 s in the demo).
  - After that the tx can never land, so an unsettled payment becomes final-expired.
  - The facilitator rejects TTLs that are already past or later than `now + maxTimeoutSeconds` (`ttl_expired`, `ttl_too_far`).
  - The facilitator returns `exact_cardano_settlement_failed` with `extra.status:"expired"` once the validity window and a short indexing grace have passed without the ledger recording the tx. [VERIFIED-IN-DOCS] SPEC rule 7; DEMO guide.md.
  - For AgentPay: `mandate.expiry` maps to tx `validTo`. The mandate-bound tx can only ever settle before its expiry. [MY-INFERENCE]
  - **Constraint:** the TTL must be at most `now + maxTimeoutSeconds` at *verify* time. A tx pre-signed with a long TTL is rejected as `ttl_too_far` unless the route's `maxTimeoutSeconds` is large. [VERIFIED-IN-DOCS] SPEC rule 7 and the signer code. The consequence for a "sign now, spend later" pre-signed tx is an [MY-INFERENCE].
- **Latency.** Preprod blocks average about 20 s. Level N takes about (N+1) x 20 s. The template says 20-60 s. Default confirmation level is 1; set 0 for demos. The hosted facilitator allows 0-20. [VERIFIED-IN-DOCS]
- **Never retry around pending settlement:** re-send the same `PAYMENT-SIGNATURE`, never build a second tx. [VERIFIED-IN-DOCS] DEVX402 agent.md gotcha 8; TPL payFlow.ts.
- **Replay:** the nonce UTxO prevents double-spend on chain, but one payment buying two operations is the app's problem. DEMO `server/src/paymentOperations.ts` binds a tx id to one route and operation id. [VERIFIED-IN-DOCS] DEMO guide.md "Replay and retries".
- **Spend controls reject lovelace by default**, and `x402Client` also caps at $1 for USDM by default. [VERIFIED-IN-DOCS] PKG README; DEVX402 agent.md.
- **Coin selection failed** in the browser means the wallet lacks the asset. It fails before signing. [VERIFIED-IN-DOCS]
- **Stale CIP-30 UTxO cache:** a wallet may return spent UTxOs after a payment. The demo filters through Blockfrost. [VERIFIED-IN-DOCS]
- **Blockfrost 402/429** means a quota or rate limit.

---

## 6. Binding a payment to a separate user-signed mandate on Cardano

AgentPay's EVM design: EIP-712 mandate, EIP-3009 payment proof, and the payment-authorization hash inside the signed mandate.

### 6a. The key structural difference [MY-INFERENCE]

On Cardano, **the signed transaction already commits to every field of an AgentPay mandate**:
- payee = output address;
- amount and asset = output value;
- expiry = `validTo`;
- nonce = a consumed input UTxO.

The wallet signature is over the tx body hash, which also covers the auxiliary-data hash (metadata) and any inline datum. A user-signed full transaction is therefore *itself* a "signed exact mandate". A separate mandate adds a human-readable typed statement, a diff on mismatch and a Block Receipt. Two ways to link the two:

- **Mandate to payment** (matches the EVM design, where the mandate contains the payment-auth hash). Cardano's tx id is `blake2b-256(body)`. You can only know it after building the tx, which is the same ordering as EIP-3009. Flow: build the tx, then user `signData` over a mandate that includes the txId. [MY-INFERENCE]
- **Payment to mandate** (more Cardano-native). The mandate has its own `nonce` and hash `H`. The payment tx **carries `H` in its metadata or datum**, and the tx signature covers it. Any verifier can then check `tx.auxiliaryData[label] == H`. [MY-INFERENCE]

Who signs the payment tx matters for the agent model:
- **Spender is an agent-held key** (an AgentPay "platform_wallet"-like hot key). The agent signs after the mandate check. The mandate guard is enforced by AgentPay, not by the chain.
- **Spender is the user's CIP-30 wallet.** The user signs the exact tx at approval time. The agent only forwards it, and it is non-malleable. `ClientCardanoSigner` is just an interface (`getAddress`, `buildAndSignPaymentTransaction`), so an "approval-time pre-signed tx" can be returned from it. [VERIFIED-IN-DOCS for the interface, PKG signer-B0QJ0K4F.d.mts; the pre-signed pattern is MY-INFERENCE.] The TTL cap above limits how long it can be held.

### 6b. Carrying the mandate hash on chain

| Mechanism | Finding |
|---|---|
| **Tx metadata (CIP-20, label 674)** | EVO supports it: `builder.attachMetadata({ label: 674n, metadata: "..." })`, with the JSDoc example "Attach a simple message (CIP-20)" in `sdk/builders/TransactionBuilder.d.ts`. [VERIFIED-IN-DOCS, EVO] The tx hash covers the auxiliary data. [MY-INFERENCE from Cardano ledger rules; not in a fetched doc] The DEMO browser signer **preserves** `auxiliaryData: unsigned.auxiliaryData`, so metadata survives into the submitted tx. The reference mnemonic signer (`toClientCardanoSigner`) sets `auxiliaryData: null`, so it drops metadata. [VERIFIED-IN-DOCS, PKG `dist/esm/index.mjs`:454 and DEMO cip30Signer.ts] **Does the facilitator accept a tx with metadata?** The verification rules (SPEC) never mention auxiliary data, and no facilitator code I grepped touches it. So it is probably accepted, but I did **not** run it. [MY-INFERENCE, must test on preprod] Metadata strings are limited to 64 bytes per chunk (ledger rule, so hash as hex in two pieces or a list). [MY-INFERENCE, not fetched] Use a custom label rather than 674 to avoid clashing with CIP-20 message UIs; both are fine technically. |
| **Inline datum** | The `script` method attaches an `extra.datum` (CBOR hex) as an inline datum to the payment output. The facilitator does NOT validate its contents. [VERIFIED-IN-DOCS, SPEC "Script Method"; PKG README] A datum on a plain address output is allowed on-chain but is not an x402 `default` feature. [MY-INFERENCE] The `payTo` must then be the script address derived from `extra.script`, `parameters` or `scriptHash`. A `script`-method contract can enforce `datum == mandate hash` on-chain. [MY-INFERENCE] |
| **Extension / extra fields** | `PaymentPayload` and `PaymentRequired` have optional `extensions`. [VERIFIED-IN-DOCS, DEMO reference.agent.md TYPES] I did not find any documented use of them for Cardano. A signed mandate can ride in `extensions` or in a separate header, verified by the resource server **before** calling `/verify`. [MY-INFERENCE] |

### 6c. Signing the mandate: CIP-30 `signData` / CIP-8 COSE_Sign1

- **Browser signing.** CIP-30 wallets expose `api.signData(address, payloadHex)`, which returns `{ signature: <COSE_Sign1 hex>, key: <COSE_Key hex> }`. [MY-INFERENCE: CIP-30 itself not fetched.] The Evolution CIP-30 wallet type has a `signMessage(address, payload)` in `sdk/wallet/*.d.ts` that returns a `SignedMessage`. [VERIFIED-IN-DOCS, EVO type declarations; I did not run it in a wallet]
- **Server-side verification in TS, already used by x402-cardano.** PKG verifies a seller's CIP-8 signature with Evolution's COSE module (`dist/esm/chunk-MVYC4VJB.mjs`:277-300):
  ```ts
  import { COSE, Address, Credential, CBOR } from "@evolution-sdk/evolution";
  const addressHex = Address.toHex(Address.fromBech32(signerBech32));
  const cred = Address.getPaymentCredential(addressHex);              // must be KeyHash
  const ok = COSE.SignData.verifyData(addressHex, Credential.toHex(cred),
              payloadBytes, { signature: coseSign1Bytes, key: coseKeyBytes });
  // signing side (server keys): COSE.SignData.signData(addressHex, payloadBytes, privateKey) -> { key, signature }
  ```
  PKG additionally validates the COSE_Key: OKP, EdDSA, Ed25519, 32-byte `x`, no private `d`. [VERIFIED-IN-DOCS] code read. `verifyData` binds the signature to the address's payment key hash. This is the **same primitive AgentPay needs** to verify the user's mandate, and it needs no extra library.
- **PKG exports a reusable helper:** `verifySellerTermsSignature(referenceKeyHex, referenceSignatureHex, sellerAddressBech32, payloadDigestHex)`. It returns boolean, never throws, and requires `hashed:false` in the unprotected header. Despite the name, it is a generic "verify CIP-8 over a 32-byte digest by this address". [VERIFIED-IN-DOCS] `index.d.mts` doc comment. Using it for mandates is [MY-INFERENCE]; also `computeTermsDigest` and `jcs` (RFC 8785 canonicalisation) are exported and could be a model for hashing the mandate. [VERIFIED-IN-DOCS]
- **Digest pattern used by Masumi x402:** `termsDigest = SHA-256("masumi:x402:terms:v1\n" || JCS(signedTerms))`, then CIP-8 sign over the 32-byte digest. [VERIFIED-IN-DOCS] PKG README and SPEC. AgentPay can use the same pattern with its own domain-separation prefix (e.g. `"agentpay:mandate:v1\n"`). [MY-INFERENCE]
- **Other libraries.** `@emurgo/cardano-message-signing`, `@meshsdk/core` (`wallet.signData`) and Lucid Evolution can also do CIP-8. I did not fetch their docs, so treat their APIs as unverified. [MY-INFERENCE] There is no reason to add them given the above.
- **Pitfalls.** Wallets differ in whether they sign the payload with `hashed:false`; the PKG verifier rejects `hashed:true`. [VERIFIED-IN-DOCS] The signing address must be a key-hash address. [VERIFIED-IN-DOCS] Test with the specific wallets (Eternl, Lace) on the day. [MY-INFERENCE]

---

## 7. Can x402 pay into Masumi escrow?

**Yes, with caveats.** [VERIFIED-IN-DOCS] PKG README "Asset transfer methods", "Masumi quotes"; SPEC; DEMO README "The Masumi agent tab"; hosted facilitator `/supported` lists `masumi`.

- Method: `extra.assetTransferMethod: "masumi"`, with `payTo` = the escrow address (`masumiEscrowAddress("cardano:preprod")`).
- The funds are **locked** in the real `vested_pay` V2 script with a 19-field inline datum (buyer, seller, nonces, input hash, `pay_by_time`, `submit_result_time`, `unlock_time`, `external_dispute_unlock_time`, `state=FundsLocked`, and so on).
- The seller signs the terms: a fresh quote per 402, `termsDigest`, CIP-8 over the digest. Both buyer and facilitator re-verify.
- Server side: `new ExactCardanoScheme({ masumi: { seller: toMasumiSellerSigner({mnemonic, network}) } })`. The route is a template with `extra:{assetTransferMethod:"masumi"}` and `payTo` = the escrow address.
- Client side: `buildMasumiLock(...)` computes the datum and locked lovelace. A custom CIP-30 signer example is DEMO `frontend/src/masumi/cip30Signer.ts`.
- **A successful x402 receipt means the lock settled, not that the seller was paid.**
- **Caveat 1:** a lock created by `@x402/cardano` **cannot be driven through a stock `masumi-payment-service` node**. The `reference_signature` is over a different payload, so refunds, result submission and disputes need x402-aware tooling holding the seller key. Quote from PKG README: use the `masumi` method "when you want the escrow's guarantees inside an x402 flow, not as a transport into an existing Masumi deployment."
- **Caveat 2:** DEMO guide.md says "Refunds and disputes are not implemented" in the demo. The demo submits the result hash and the seller runs `npm run collect` after `unlock_time`.
- **Caveat 3:** exact `lockedLovelace == requested + collateral`. A Masumi-built tx that rounds up to min-UTxO will not satisfy an x402 402.
- A non-empty `agentIdentifier` is rejected unless you supply `validateRegistryClaim`. The demo's `masumi/src/registry.ts` does this against the on-chain registry (registry policy `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b`).
- **Masumi seller side** needs a seller wallet with about 20 tADA, a public HTTPS URL, `npm run register` and `npm run agent` in the DEMO `masumi/` folder. Demo's "Replay an example" mode needs no setup. [VERIFIED-IN-DOCS] DEMO README.
- Impact for AgentPay: the track rubric names Masumi. A mandate-guarded purchase *into* Masumi escrow (user signs mandate, agent builds the lock tx, AgentPay refuses on mismatch) is a possible demo. The datum cannot be changed because it follows Masumi's schema, so the mandate hash would have to go in tx metadata and not in the datum. [MY-INFERENCE]
- Custom smart contract via `script` is the other Cardano-tech path; the contract and datum are the server's responsibility. [VERIFIED-IN-DOCS]

---

## 8. AI-assisted dev tooling for Claude Code

Source for all: https://developers.cardano.org/docs/developers/curriculum/start-building/ai-assisted-development/ [VERIFIED-IN-DOCS] unless marked.

1. **Cardano Dev Skills** (Cardano Foundation), https://github.com/cardano-foundation/cardano-dev-skills. Install in Claude Code:
   ```
   /plugin marketplace add cardano-foundation/cardano-dev-skills
   /plugin install cardano-dev-skills@cardano-dev-skills
   ```
   Then run `/cardano-context`, which writes a directive block into the project's `CLAUDE.md` telling Claude to consult the bundled skills and docs first. 18 skills per the repo page, including `build-transaction`, `connect-wallet` (CIP-30), `debug-transaction`, `design-token`, `explain-cip`, `explain-eutxo`, `query-chain`, `scaffold-project`, `setup-devnet`, `write-validator`, `review-contract`, `suggest-tooling`. For other agents: `git clone https://github.com/cardano-foundation/cardano-dev-skills.git` then `ln -s ../cardano-dev-skills/skills .agents/skills`.
2. **Masumi Skills**, `npx skills add https://github.com/masumi-network/masumi-skills --skill masumi` (source: https://www.masumi.network/dev/masumi/documentation/integrations/masumi-skills). Covers payment flows, agent registration, smart contracts, Cardano mechanics, MIP-003 API and Sokosumi. Also published at masumi.network/skill.md.
3. **Mesh AI**, https://meshjs.dev/ai: chatbot, MCP server, agent skills, `llms.txt`. MCP install from https://meshjs.dev/ai/mcp:
   ```
   claude mcp add-json mesh-mcp '{"command":"npx","args":["-y","meshjs-mcp"],"env":{"API_KEY":"your-api-key","MODEL":"your-preferred-model"}}'
   ```
   It needs your own LLM provider key. Mesh agent skills install page is `/docs/ai/skills`; **I did not fetch it, so no command**.
4. **Chain access over MCP:** the page describes the concept only ("the agent proposes and you sign"), names no server and gives no install command. It points to https://developers.cardano.org/tools/ ("Builder Tools"). **I did not fetch that list.**
5. **x402-specific agent reference:** https://developers.cardano.org/x402/agent.md (written for coding agents; read it in the session) and the DEMO's `docs/x402/reference.agent.md` (wire fields and error codes). [VERIFIED-IN-DOCS]
6. For Evolution SDK: no Claude Code skill found. `.d.ts` JSDoc is detailed (I used it above).

My recommendation, as it affects the build: install 1 and 2, then run `/cardano-context`. Per the global rule, at most one process skill per task; these are reference skills, not process skills. [MY-INFERENCE]

---

## 9. Mapping onto the AgentPay architecture (suggestions)

| EVM version | Cardano equivalent | Basis |
|---|---|---|
| EIP-712 mandate | CIP-8 / CIP-30 `signData` over `SHA-256(domain-prefix \|\| JCS(mandate))`, verified with `COSE.SignData.verifyData` | 6c |
| EIP-3009 payment proof | A signed Cardano tx (full CBOR) carried in `PAYMENT-SIGNATURE` | 1 |
| Payment-auth hash inside the mandate | tx id inside the mandate (mandate to payment) **or** mandate hash in tx metadata (payment to mandate) | 6a, 6b |
| Expiry | tx `validTo`, plus the facilitator's TTL checks | 5 |
| Nonce | Consumed input UTxO (`payload.nonce`) plus the mandate's own nonce | 1 |
| Refuse with a diff | Compare decoded tx (`decodeCardanoTransaction` from `@x402/cardano`) to the mandate before releasing the signed bytes | [MY-INFERENCE] |
| Platform wallet | Agent-held mnemonic via `toClientCardanoSigner` | 3b |
| User wallet | CIP-30 signer adapted from TPL `cip30.ts`; user signs the exact tx | 3c, 6a |
| Block Receipt | Any signature by the AgentPay key (receipt signing is separate from payment signing); on Cardano the AgentPay server key can use `COSE.SignData.signData` | [MY-INFERENCE] |

`decodeCardanoTransaction(base64)` returns a summary including `txHash` and `ttlSlot` (used in DEMO `server/src/app.ts`). Its full field list (outputs, auxiliary data) was **not** verified; see `DecodedCardanoTransaction` in `dist/esm/types-BU8jAfFp.d.mts` before relying on it for diffing. `slotToPosixMs(network, slot)` converts TTL slots. [VERIFIED-IN-DOCS for the two functions existing, DEMO app.ts]

---

## 10. Not verified / not fetched

- Did **not** run any payment end to end on preprod (no keys, no wallet, no funds). Only `GET /supported` on the hosted facilitator was run.
- Whether the facilitator **accepts a tx with auxiliary data / metadata** (no source says either way; must test). The same applies to inline datums on `default` outputs.
- Metadata chunk-size limit (64 bytes) and "tx hash covers auxiliary-data hash" are standard Cardano ledger facts from my own knowledge, not from a fetched source.
- CIP-30 `signData` return shape and CIP-8 spec were **not** fetched; the Evolution `signMessage` type exists but I did not run it against Eternl or Lace. Behaviour of `hashed` flag per wallet is unknown.
- `@emurgo/cardano-message-signing`, `@meshsdk/core` and Lucid Evolution COSE APIs: not fetched.
- Whether `@x402/cardano 2.28.0` and the hosted facilitator's version are compatible with each other (templates pin 2.26.0). The hosted facilitator's version is unknown.
- The `DecodedCardanoTransaction` field list; the contents of `@x402/paywall` (peer dep of `@x402/next`) and whether it supports Cardano. TPL says "the stock x402 paywall package ... does not cover Cardano yet".
- DEMO server `masumi.ts`, `paymentOperations.ts` and `masumi/` agent source: only partially read (their README, guide and reference were read).
- Masumi docs beyond the skills page: the Masumi payment-service API and a Masumi registry/escrow on mainnet.
- https://developers.cardano.org/tools/ (Builder Tools), Mesh `/docs/ai/skills`, and any Cardano MCP server for chain access: not fetched.
- Hackathon-specific details (e.g. event-hosted facilitator/Blockfrost keys, rules): no source fetched. DEVX402 agent.md mentions an "October 6 morning session" for the hosted facilitator URL.
- Mainnet: DEVX402 agent.md says preprod only; PKG README and the hosted mainnet URL suggest otherwise. Not tested.
- WebFetch summarises pages through a small model, so quotes of long pages (DEVX402, ai-assisted-development, the spec) are summaries, not verbatim. The package README, DEMO files, TPL files and `.d.mts`/`.mjs` code were read raw.
