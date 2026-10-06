# PLAN — 36-hour build (solo)

> Start: Tue 6 Oct 12:00 SGT. Hard deadline: Wed 7 Oct 23:59 SGT. No late entries.
> Rule: do the slow external things (mint, approval, deploy) first, in parallel with code.
> Tick a box only with evidence (tx hash, test output, URL).

## Spikes — prove these first (each ≤ 45 min, stop when answered)

| ID | Question | How to test | Fallback if no |
|---|---|---|---|
| S1 | Does the hosted x402 facilitator accept a tx with metadata label 674? | Build a 1 tADA x402 payment with `attachMetadata({label:674n})`, send to facilitator. | Drop the metadata link; bind by putting the proposal tx id in the Receipt only. |
| S2 | Exact `masumiPayment` JSON and the signed-seller-terms call | `curl :3012/api-docs`, `sokosumi skills`, read `masumi-network/demo-agent-token2049`. | Ask a Masumi mentor on Telegram. |
| S3 | CIP-30 `signData` return shape in Lace and Eternl | Tiny page: sign `JCS(mandate)`, verify with evolution-sdk. | Use one wallet only in the demo. |
| S4 | Can signed terms use a short `unlockTime` for the demo? | Read terms API from S2. | Show escrow lock + result hash; show collection later in the write-up. |

## Milestones

### M0 — Accounts and slow paths (h0–h3) — start 12:00
- [x] Sokosumi preprod account, `sokosumi` CLI, Vendor, private Coworker (`--capability tasks`).
      Evidence: `docs/EVIDENCE.md` Sokosumi — Vendor `01a10f51-8397…`, Coworker `01a10f51-9560…` (11:46 SGT).
- [ ] Request event workspace connect + approval **now** (approval is manual).
      Requested ~11:48 SGT; approval **PENDING** (`docs/EVIDENCE.md` Event workspace, `docs/OPS.md`).
- [x] Blockfrost preprod key. Postgres + MPS running locally on :3012, health OK.
      Evidence: `docs/EVIDENCE.md` Masumi — payment source `Web3CardanoV2` seeded 12:04 SGT; health check in `docs/OPS.md`.
- [ ] Fund selling wallet + Orchestrator wallet from dispenser.masumi.network.
      Selling wallet DONE (100 tADA + 100 tUSDM, `docs/EVIDENCE.md` Selling wallet address). Purchasing (Orchestrator) wallet NOT DONE.
- [x] Register agent in MPS admin (Dynamic pricing). Mint takes 5–15 min: start it, move on.
      Evidence: `docs/EVIDENCE.md` Masumi — RegistrationConfirmed 12:19 SGT, mint tx `c7971f7a…e9e8f5`, agentIdentifier `67ab0c92…000000`.
- [x] Repo scaffold: Next.js + `src/` + tsconfig + lint + vitest (T-001, merge 8ffcf5a; typecheck/lint/test/build green). `.env.example` still to fill (T-005).

### M1 — guard-core (h3–h8)
- [x] Mandate schema (zod), JCS, digest. Unit tests. (T-002, 41 tests green; review APPROVE 7f97272)
- [ ] CIP-8 verify (S3 done). Test with a real wallet signature fixture.
      T-003 merged: verify + 20 forgery cases green (review 824c842). Real-wallet fixture still open (needs S3).
- [x] Matcher `x402` + Diff + reason codes. Tests for S1 happy path and S2 injection. (T-004, 116 tests green; review APPROVE b48ac7d)
- [x] Guard Receipt sign/verify with Guard Key. (T-005, 140 tests green; review APPROVE 9b33951)

### M2 — Worker and paid Task (h8–h14)
- [ ] Free rehearsal Task: `runtime start` → Guard Check → `runtime complete`.
- [ ] Idempotency table `{taskId, eventId, action}`.
- [ ] Paid Task end to end: masumiPayment → FundsLocked → result hash → complete. Save tx hashes.
- [ ] Deploy MPS + worker + Postgres to Railway. Confirm a Task runs with laptop closed.

### M3 — Web (h14–h19)
- [ ] `/mandate`: connect wallet, edit fields, sign, copy bundle.
- [ ] `/receipt/:id`: Verdict, Diff table, on-chain links (Cardanoscan preprod).
- [ ] Landing: one-line promise, 3-step picture, link to Sokosumi listing.

### M4 — Demo Orchestrator + x402 (h19–h25)
- [ ] demo-seller: x402-paid route on preprod (template `x402-express`).
- [ ] Orchestrator: reads page → proposal → hires Guard → pays on APPROVE only.
- [ ] Injected page variant changes payee + amount → REFUSE with Diff.
- [ ] Matcher `cardano-tx` + metadata 674 link (if S1 = yes).
- [ ] `/demo` arena: S1 / S2 buttons, live log.

### M5 — Event run and evidence (h25–h29)
- [ ] Paid Task in the event workspace. Record: Coworker ID, Task IDs, payment tx, result hash,
      collection tx, seller address, token unit, net tUSDM received.
- [ ] README run instructions tested from a clean clone.

### M6 — Submission (h29–h36) — finish by 7 Oct 22:00, buffer 2 h
- [ ] Demo video ≤ 3 min (`docs/DEMO.md`).
- [ ] Slides (Google Drive, .ppt/.keynote) with video embedded.
- [ ] Write-up: problem, approach, Cardano tech used, how to scale.
- [ ] Submit to main track, then add the Cardano track. See `docs/SUBMISSION.md`.

## Cut list (cut from the top when late)

1. Aiken mandate vault (DEC-T07).
2. Budget Mandates (DEC-T06).
3. `masumi-purchase` matcher.
4. Guard as x402-paid HTTP endpoint and MCP tool.
5. `cardano-tx` matcher + metadata link (keep `x402` matcher).
6. Registry lookup check.

**Never cut:** CIP-8 Mandate verify, x402 matcher, paid Task with on-chain result hash,
hosted deploy, the S2 injection demo, the video.
