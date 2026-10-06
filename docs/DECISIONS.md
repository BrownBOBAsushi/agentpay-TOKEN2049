# DECISIONS — Log

> Add new decisions at the bottom. Do not edit an old one; write a new one that replaces it.
> Format: ID, date, decision, why, status.

## DEC-T01 — Product shape: Guard Coworker
- **Date:** 2026-10-06
- **Decision:** AgentPay is a Masumi Coworker on Sokosumi that other agents hire per Guard
  Check before they pay. A small demo Orchestrator shows the attack and the block.
- **Why:** Organisers recommend "In between" + live on Preprod + registered on Sokosumi.
  Workshop slide 15 lists "a trust check that verifies an agent's credential before you pay".
  Selling the Guard as a paid Task also meets the paid-Task requirement with our own product.
- **Status:** Accepted.

## DEC-T02 — North star: spend safely, prompt injection only
- **Decision:** Every build item must push toward "an agent can only spend what its human
  signed". One live demo scenario (web page injection). Non-goals: direct user injection,
  phishing, key compromise.
- **Status:** Accepted (carried from the old AgentPay DEC-001/DEC-002).

## DEC-T03 — Language: TypeScript, Node 24
- **Why:** Sokosumi CLI, eve, MPS, `@x402/cardano` are all JS/TS. One language for a solo build.
  Skip Python `masumi` SDK and Kodosumi.
- **Status:** Accepted.

## DEC-T04 — Mandate signature: CIP-8 via CIP-30 signData
- **Decision:** Replace EIP-712 with CIP-30 `signData` (COSE_Sign1, Ed25519). Payload =
  `JCS(mandate)`. Verify with `COSE.SignData.verifyData` from `@evolution-sdk/evolution`.
  Digest = `SHA-256(prefix ‖ JCS(mandate))`, same pattern as Masumi seller terms.
- **Why:** Native Cardano wallets (Lace, Eternl) sign it. No extra crypto library.
- **Status:** Accepted. Wallet return shape is SPIKE S3.

## DEC-T05 — Coworker path: Sokosumi polling worker + self-hosted MPS
- **Decision:** Follow the hackathon Coworker path (poll `/coworkers/me/events`), not the
  classic MIP-003 push server. Self-host MPS + Postgres on Railway from day one.
- **Why:** No hosted preprod payment service. Judges need a hosted demo, not a laptop.
- **Status:** Accepted.

## DEC-T06 — Mandate match is exact
- **Decision:** MVP matches payee, asset, and amount exactly; deadline must be ≤ expiry.
  No budgets, no ranges.
- **Why:** Exact match is easy to explain in a 3-minute video and has no edge cases.
- **Status:** Accepted. Budget Mandates are a cut-list stretch.

## DEC-T07 — On-chain enforcement is a stretch
- **Decision:** MVP binding is off-chain (Guard Receipt anchored on chain by Masumi). An Aiken
  "mandate vault" validator that requires a Guard signature is stretch only.
- **Why:** 36 hours solo. Masumi escrow + result hash already gives strong Cardano use.
- **Status:** Accepted.

## DEC-T08 — Built during the hackathon
- **Decision:** Write all code new in this repo during the event. The old AgentPay repo is a
  source of ideas only. Do not copy files from it.
- **Why:** Track rule: "Projects must be built entirely during the 36-hour hackathon."
- **Status:** Accepted.
