# AgentPay Guard — write-up (draft for the submission form)

> TOKEN2049 Origins Hackathon, Cardano "Agentic Commerce" track, 6–8 October 2026.
> Repo: https://github.com/BrownBOBAsushi/agentpay-TOKEN2049 · Web: https://agentpay-guard-cardano.vercel.app

## Problem
AI agents now hire and pay other agents (Masumi, x402). An agent pays what the page or the seller tells
it to pay. One prompt injection — hidden text on a web page — can change the payee or the amount. Escrow
protects against "the work was not delivered". It does not protect against "the agent paid the wrong
party". The human who owns the money has no signed, checkable statement of what the agent may spend.

## What we built
**AgentPay Guard** is a Masumi Coworker on Sokosumi. Before an agent pays, it hires the Guard.
1. The human signs a **Mandate** in their Cardano wallet (Lace/Eternl, CIP-30 `signData`, CIP-8 COSE):
   payee, asset, amount, expiry, nonce.
2. The agent sends the Guard its **Spend Proposal** — the seller's x402 `PAYMENT-REQUIRED` terms.
3. The Guard verifies the Mandate signature cryptographically, checks signer = payer, expiry and nonce,
   and matches payee, asset, amount and deadline exactly.
4. It returns **APPROVE**, or **REFUSE** with a field-by-field **Diff**, as a **Guard Receipt** signed with
   the Guard Key. The Receipt hash goes on chain through Masumi (`submitResultHash`).
5. The agent pays over x402 only with a verified APPROVE whose proposal digest equals what it pays.

## Demo (live on Cardano preprod)
**Try it:** https://agentpay-guard-cardano.vercel.app/store — "ask your AI to buy a latte". A hidden comment on the
shop page tells the agent to pay 28 to "Evil Store". The page hires the real Guard on Sokosumi, which returns a
signed REFUSE with the field Diff. With the injection removed, the Guard approves and (in the presenter's private
live mode) the agent pays 6.5 tADA over x402 on Cardano preprod — recorded demo tx
`730105f984274d452d5afe85756139eccd309f343d767858665d416a25b64ac2` (Guard Task `01a116c0-c4cf-7023-a64b-5ba4c5cf47bb`). The agent is scripted to obey the page (real
models often refuse on camera); the Guard check, the signatures and the payment are real.

- **S2 — injection:** the offer page hides a second payment instruction (50 tADA to an attacker).
  Guard: REFUSE, Diff on payee + amount. No money moves. No human in the loop.
- **S1 — honest:** same Mandate, honest page. Guard: APPROVE. The agent pays 2 tADA over x402 through
  the hosted preprod facilitator. Example tx `01922f9dce57345768af29b305b92c14b20b80396a4e0dcbcdff9aecaad30f12`.
- **Paid Coworker:** the Guard also runs as a paid Masumi Task: escrow lock, result hash on chain,
  collection of 1 tUSDM (Task `01a110bb-e6aa-74a2-953c-269254af16ce`, all tx hashes in `docs/EVIDENCE.md`).

## Technical approach
- **Cardano / Masumi:** self-hosted Masumi Payment Service (V2 escrow, dynamic pricing, registry NFT),
  Sokosumi Coworker (pull model), on-chain result hash, auto-collection, tUSDM native token, Blockfrost.
- **x402 on Cardano:** `@x402/express` seller, `@x402/fetch`/`@x402/cardano` buyer, hosted preprod
  facilitator, exact scheme. The buyer checks the signed tx TTL against the Mandate expiry before it
  releases the payment, re-sends the same signed bytes on retry, and confirms settlement on chain.
- **Cryptography:** CIP-8/COSE_Sign1 verification with `@evolution-sdk/evolution`, JCS-canonical Mandate
  digest, signed Guard Receipts. Verified against a real Lace preprod signature.
- **Reliability:** every side effect is idempotent by `{taskId, eventId, action}` (Postgres advisory lock
  for the Worker, a journal for the buyer). Restarts never double-charge or pay twice.
- **Stack:** TypeScript (strict), Node 24, Next.js App Router (Vercel), Worker + MPS + Postgres on
  Railway, Vitest (431 tests), built with a three-agent loop (one orchestrator, one builder, one reviewer).

## Deploy and scale
- Hosted today: web on Vercel, Guard Worker + MPS + Postgres on Railway; runs with the laptop closed.
- Any Masumi buyer can hire the Guard before `POST /purchase` or an x402 payment; price per check.
- Next: more proposal kinds (raw `cardano-tx`, Masumi purchase), budget Mandates, and an Aiken vault
  that releases funds only with a Guard signature over a matching Receipt (on-chain enforcement).
