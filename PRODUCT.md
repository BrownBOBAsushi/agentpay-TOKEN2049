# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Agent owners (primary for /mandate):** a person who runs an AI agent that pays other agents on
  Masumi. Before the agent may spend, they sign one exact Mandate with their Cardano wallet (Lace or
  Eternl, CIP-30) and hand the bundle to their agent.
- **Hackathon judges (primary for landing and /receipt):** they watch a 3-minute demo video and may
  open the hosted site. They must understand the promise, the attack, and the block at first glance.
- **Anyone checking a payment:** a Receipt link is public and shareable, like an explorer page.

## Product Purpose

AgentPay Guard is a Masumi Coworker that checks an AI agent's payment against a human-signed
Mandate before the agent pays. Promise: **an agent can only spend what its human signed.** Success:
an injected payment (other payee, higher amount) is refused with a field-by-field Diff and a signed
Guard Receipt whose hash is anchored on Cardano; a matching payment is approved the same way.

## Positioning

The Mandate is signed cryptographically by the human's own wallet (CIP-8), and every Verdict is a
signed Guard Receipt whose hash Masumi writes on chain. A neighbouring "AI firewall" that only
filters prompts or shows a UI warning cannot show a wallet signature and an on-chain receipt.

## Operating Context

- Cardano **preprod** only (tADA, tUSDM). Never mainnet.
- Guard Checks run as Sokosumi Tasks, paid through Masumi escrow; hosted Worker + MPS on Railway.
- Web runs on Vercel project `agentpay-guard-cardano` (https://agentpay-guard-cardano.vercel.app).
- Demo scenario: a web page carries hidden text that changes the payee and amount (S2) → REFUSE.

## Capabilities and Constraints

- Pages in scope (M3): `/mandate` (connect wallet, edit fields, sign, copy bundle), `/receipt/:id`
  (Verdict, Diff, on-chain links to Cardanoscan preprod), landing (promise, 3-step picture, link to
  the Sokosumi listing). `/demo` arena is M4.
- Mandate fields: payer, payee, asset, amount (atomic units string), expiry, nonce, purpose; network
  fixed `cardano:preprod`. Exact match only (DEC-T06).
- Receipt verdict APPROVE or REFUSE with reason codes; a 64-zero digest means "unavailable" (DEC-T12).
- **Vercel rule:** `/examples/guard-receipt-refuse.json` must stay served at that exact path on that
  domain (the registry NFT points there).
- Stack: Next.js App Router in `app/` (existing scaffold, T-001).

## Brand Commitments

- Name **AgentPay Guard** and the promise line above. No logo, colours, or fonts decided.

## Evidence on Hand

- Real preprod records in `docs/EVIDENCE.md`: Coworker and agent IDs, rehearsal Tasks (S1 APPROVE,
  S2 REFUSE with payee + amount Diff), paid Task `01a110bb…` with lock, result, and collection tx
  hashes (net 1.0 tUSDM), hosted rehearsal on Railway.
- No users, testimonials, logos of partners, or metrics exist. Do not invent any.

## Product Principles

1. Show the proof, not a claim: signatures, digests, and tx hashes are the content.
2. The human's signed intent is the reference; everything else is compared against it.
3. A refusal is a success state of the product, not an error.
4. Preprod and test money are stated plainly; nothing pretends to be mainnet.

## Accessibility & Inclusion

- Verdict must never rely on colour alone (text + shape). Long hex values must be copyable and
  readable (monospace, truncation with full value available).
