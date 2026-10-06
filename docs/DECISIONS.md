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

## DEC-T09 — Seller flow API shapes (answers SPIKE S2 and S4)
- **Date:** 2026-10-06
- **Decision:** Follow the organisers' live demo `masumi-network/demo-agent-token2049`, branch
  `live-demo-name-finder`, file `live-team-names-20261006/paid-task.mjs` (reached confirmed
  `ResultSubmitted` on preprod). Shapes:
  - Signed seller terms: MPS `POST /api/v1/payment` (header `token: <MPS runtime token>`) with
    `{network:"Preprod", agentIdentifier, paymentSourceType:"Web3CardanoV2",
    supportedPaymentSourceIndex, inputHash, identifierFromPurchaser, RequestedFunds:[{amount,unit}],
    payByTime, submitResultTime, unlockTime, externalDisputeUnlockTime (ISO strings), metadata}`.
    Response `{status:"success", data:<payment>}`.
  - `masumiPayment`: Core `POST /v1/tasks/{id}/events` with `{comment, masumiPayment:{blockchainIdentifier,
    agentIdentifier, sellerVkey, submitResultTime, payByTime, unlockTime, externalDisputeUnlockTime,
    inputHash, identifierFromPurchaser, paymentSourceType, supportedPaymentSourceIndex,
    Amounts:[{amount,unit}], PaymentSource:{network, smartContractAddress, policyId}}}`, built from
    the MPS payment (refuse if `sellerReturnAddress` is not null).
  - Escrow state: MPS `POST /api/v1/payment/resolve-blockchain-identifier`
    `{network, blockchainIdentifier, includeHistory:"true"}`; proceed only on `onChainState`
    `FundsLocked` with a `Confirmed` transaction to that state.
  - Result: MPS `POST /api/v1/payment/submit-result {network, blockchainIdentifier, submitResultHash}`.
  - Complete: Core `POST /v1/tasks/{id}/events {status:"COMPLETED", comment:<result>}`.
  - Settlement: Core `GET /v1/tasks/{id}/receipt` (`settled`, `txHash`).
  - S4: the seller sets `unlockTime` itself in `POST /payment`. Use the demo offsets:
    payBy +5 min, submitResult +20 min, unlock +36 min, externalDisputeUnlock +52 min.
- **Transport:** call Core over HTTPS with `Authorization: Bearer $SOKOSUMI_COWORKER_API_KEY`
  (base `https://api.preprod.sokosumi.com`), not through the `sokosumi` CLI. orch checked
  2026-10-06: `GET /v1/coworkers/me`, `/v1/coworkers/me/events`, `/v1/tasks?coworkerId=` all
  return 200 with the coworker key. Why: the hosted worker has no OS vault, and CLI OAuth expires
  after ~1 hour (`docs/OPS.md`).
- **Status:** Accepted. Replaces the "SPIKE S2" marks in `ARCHITECTURE.md`.

## DEC-T10 — Result hash is SHA-256 of the exact UTF-8 result
- **Date:** 2026-10-06
- **Decision:** `inputHash = sha256(utf8(task description))` and
  `submitResultHash = sha256(utf8(result text))`, 64 hex, as in the demo (DEC-T09).
  This replaces the MIP-004 `inputHash ‖ outputHash` form in `ARCHITECTURE.md` step 7.
- **Why:** The demo form is proven on preprod (`ResultSubmitted` confirmed). The MIP-004 form is
  from older skill docs and is not proven with MPS on :3012.
- **Status:** Accepted.

## DEC-T11 — Guard Task input, output, and nonce use
- **Date:** 2026-10-06
- **Decision:** The Task description is UTF-8 JSON `{"mandateBundle":…, "proposal":…}`. The Task
  result is the JSON of the signed Guard Receipt (`signReceipt` output). A Mandate nonce is
  *consumed* only by an `APPROVE` (one Mandate pays once). A `REFUSE` does not consume it. The
  nonce row stores the Task ID, so re-running the same Task is not `NONCE_REUSED`.
- **Why:** A refused attack must not burn the human's Mandate; an approved one must not pay twice.
- **Status:** Accepted.
