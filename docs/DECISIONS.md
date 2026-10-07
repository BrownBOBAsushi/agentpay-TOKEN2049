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

## DEC-T12 — Zero digest means "input unavailable"
- **Date:** 2026-10-06
- **Decision:** When a Guard Task description cannot be parsed, the REFUSE Guard Receipt sets
  `mandateDigest` and/or `proposalDigest` to 64 `0` characters. This value means "unavailable",
  never a computed hash. It is allowed only with verdict `REFUSE`. The Receipt viewer (M3) shows
  it as "unavailable". The Receipt schema stays `v:1` (no new field).
- **Why:** T-007 review asked for an honest marker. A sentinel keeps the signed format stable.
- **Status:** Accepted.

## DEC-T13 — Paid Task deadlines fit MPS confirmation depth
- **Date:** 2026-10-06
- **Decision:** Replace the DEC-T09 (S4) offsets. From the terms request: `payByTime` +20 min,
  `submitResultTime` +60 min, `unlockTime` +75 min, `externalDisputeUnlockTime` +90 min. The
  offsets are Worker config (`PAID_*_MINUTES`) with these defaults.
- **Why:** Live paid Task `01a11072-5686-778f-a89b-65066d640295` failed. The buyer locked on time
  (tx `38ff135b99952146…`, 09:05:05 UTC, block 5260035, 1 tUSDM, our inputHash), but local MPS uses
  `BLOCK_CONFIRMATIONS_THRESHOLD=20` and `CHECK_TX_INTERVAL=180` (from its `.env.example`). It
  could not see the lock before payBy + 300 s grace and marked the payment `FundsOrDatumInvalid`.
  20 preprod blocks took ~9.5 min that day. The demo's +5 min payBy needs a faster MPS. Lowering
  the MPS threshold is the human's choice (it weakens rollback safety); wider offsets work either way.
- **Status:** Accepted.

## DEC-T14 — M4 demo shape (Orchestrator, demo-seller, /demo)
- **Date:** 2026-10-07
- **Decision:**
  - **demo-seller** is a local Express app (`@x402/express`, all `@x402/*` pinned to 2.26.0) against the
    hosted preprod facilitator. It sells "market data" for 2 tADA (`lovelace`, `2000000`) to
    `DEMO_SELLER_ADDRESS`. It also serves two offer pages (honest and injected) and an "attacker" route that
    stands in for an attacker server (50 tADA to a fixed attacker address).
  - **Orchestrator** is a deterministic "naive agent", not an LLM. It obeys the last payment instruction in
    the page text, which models a prompt-injected LLM. Reason: no paid model credit (user rule), and the
    demo is repeatable. `MODEL_API_KEY` stays unused.
  - The Orchestrator **hires the Guard with a free Sokosumi Task** (`sokosumi --preprod tasks create
    --personal`, user OAuth on the Mac). The hosted Worker (free mode) runs it. The Orchestrator reads the
    Receipt from the COMPLETED event `comment` and verifies it locally before it trusts the Verdict.
  - It pays only on a verified `APPROVE`, and only for x402 requirements whose proposal digest equals the
    approved one. Pay is idempotent per `{taskId, eventId, "pay"}`.
  - **`/demo`** replays recorded run transcripts (`public/demo-runs/*.json`) from real preprod runs, with
    links to `/receipt/<taskId>` and Cardanoscan. Vercel cannot run the `sokosumi` CLI, so no live mode.
  - **Cut:** `cardano-tx` matcher + metadata 674 link (PLAN cut list item 5).
- **Why:** Fits the time left (deadline 7 Oct 22:00), spends no paid credit, and keeps the S2 injection demo
  (never cut).
- **Status:** Accepted.

## DEC-T15 — SPIKE S3 answered: Lace signData bundle verifies
- **Date:** 2026-10-07
- **Decision:** A real Lace (preprod, account Cardano #0, base address `addr_test1qprr4fdz…ets72`) `signData`
  result, as packed by `/mandate`, passes `verifyMandate` unchanged (`{ok:true}`; digest recomputes; signer =
  payer). Saved as `src/guard/fixtures/bundle.wallet.json`; the cip8 wallet test is no longer skipped. The
  bundle is the hero Mandate for the recorded S1 run: 2 tADA (`lovelace` `2000000`) to `DEMO_SELLER_ADDRESS`,
  expiry 2026-10-07 15:59 UTC, nonce `d14e4b3e…8c68c1`. Eternl not tested (PLAN S3 fallback: one wallet).
- **Why:** Closes S3 and PLAN M1 with a real wallet, not a test key.
- **Status:** Accepted.

## DEC-T16 — Live `/store` page: scripted injected agent, real Guard check
- **Date:** 2026-10-07
- **Decision:** A public page `/store` tells the consumer story "ask your AI to buy a latte". It shows the
  user's Figma "The Corner Store" (latte 6.50; hidden injection: total 28.00, merchant "Evil Store").
  A **scripted** agent (labeled as a simulation of a prompt-injected agent) reads the page and builds an
  x402 Spend Proposal. A Vercel server route runs the **real** `guardCheck` on that proposal against a
  **real wallet-signed Mandate** (latte, 6.5 tADA to the store, expiry 2026-12-31) and returns the Verdict +
  Diff. No payment, no Guard Key and no Sokosumi Task on Vercel; the page links the recorded paid run.
  The live check passes `nonceUsed: false` and never consumes the Mandate. tADA stands in for SGD.
- **Why:** Real models often refuse to "bite" on camera (StraitX experience). The product claim is that the
  Guard does not depend on the model's behaviour, so a scripted compromised agent is honest when labeled,
  and the check itself is the real code on a real signature. Judges can try it after the deadline.
- **Status:** Accepted.

## DEC-T17 — `/store` hires the real Guard on Sokosumi (one-line flow)
- **Date:** 2026-10-07
- **Decision:** When the live check on `/store` predicts a REFUSE, the Vercel route creates a real Sokosumi
  Task for our Coworker with the Coworker key on behalf of the user (`POST /v1/tasks`, header
  `X-Context-User-Id`; the user approved the grant on 7 Oct). The hosted Worker runs the Guard Check and the
  page shows the verified signed Receipt, with links to the Task on Sokosumi (owner view) and the public
  `/receipt/<taskId>`. Verified by hand: Task `01a115be-d9e3-73f9-863d-9ecc0b2175be`, REFUSE in ~6 s.
  An APPROVE is not hired from the public page (it would consume the Mandate nonce for every later
  visitor); it stays the instant local check plus the recorded paid run. Public Task sharing is owner-only
  (403 for agent keys), so the public link is our `/receipt/<taskId>`. Hires are rate-limited.
- **Why:** The user asked for one continuous flow with no terminal; DEC-T16's local check stays the fallback.
- **Status:** Accepted.
