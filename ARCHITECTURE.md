# ARCHITECTURE — How AgentPay Guard works

> Read `CONTEXT.md` first for the words. API facts come from `docs/research/`; items marked
> **SPIKE** are not yet proven and have a test in `docs/PLAN.md`.

## System overview

```
 HUMAN                                   ORCHESTRATOR (untrusted buyer agent)
   │ 1. signs Mandate (CIP-30 signData)     │ reads web page (may hold injection)
   │    on /mandate page                    │ builds Spend Proposal
   ▼                                        │ 2. hires Guard (Sokosumi Task / direct API)
 ┌──────────────────────────────┐           ▼
 │ WEB (Next.js, Vercel)        │   ┌──────────────────────────────────────────┐
 │ /mandate  wallet sign        │   │ GUARD WORKER (Node, Railway)             │
 │ /receipt/:id  viewer         │   │ polls Sokosumi /coworkers/me/events      │
 │ /demo  arena S1 / S2         │   │ Masumi seller flow ↔ MPS                 │
 └──────────────────────────────┘   │ runs guard-core → Verdict + Receipt      │
                                    │ idempotency store (Postgres)             │
                                    └───────────┬──────────────────────────────┘
                                                │ submitResultHash (Receipt hash)
                                                ▼
 ┌──────────────────────────────┐   ┌──────────────────────────────────────────┐
 │ x402 FACILITATOR (hosted)    │   │ MPS (self-hosted, Railway) + Postgres    │
 │ verifies + submits pay tx    │   │ escrow, result hash, collect tUSDM       │
 └──────────────┬───────────────┘   └───────────┬──────────────────────────────┘
                ▼                               ▼
          ┌─────────────────────────────────────────────┐
          │ CARDANO PREPROD  (tADA, tUSDM native token)  │
          └─────────────────────────────────────────────┘
```

## Components

| Part | Path | Runs on | Job |
|---|---|---|---|
| **guard-core** | `src/guard/` | library | Pure TS. Mandate schema, JCS digest, CIP-8 verify, three proposal matchers, Diff, Verdict, Receipt sign. No network. Most tests live here. |
| **worker** | `src/worker/` | Railway | Polls Sokosumi, runs the Masumi seller flow per Task, calls guard-core, writes idempotency rows. |
| **web** | `app/` | Vercel | Mandate signing (CIP-30 wallet: Lace / Eternl), Receipt viewer, demo arena, landing. |
| **orchestrator** | `src/orchestrator/` | local / Railway | Demo buyer agent. Reads a page, proposes a spend, hires the Guard, pays via x402 only on APPROVE. |
| **demo-seller** | `src/demo-seller/` | Railway | Small x402-paid API ("market data") that the Orchestrator buys from. Gives the payee for the demo. |
| **MPS** | external repo | Railway | `masumi-payment-service`, port 3012, `Web3CardanoV2`, Dynamic pricing. |

## The Guard Check, step by step

1. **Mandate.** Human opens `/mandate`, connects a CIP-30 wallet, and signs
   `JCS(mandate)` with `signData`. Web returns a Mandate bundle:
   `{mandate, coseSign1, coseKey, payerAddress, digest}`.
2. **Proposal.** The Orchestrator builds a Spend Proposal. Kinds, in build order:
   - `x402` — the `PAYMENT-REQUIRED` requirements from a seller (payTo, asset, amount, timeout).
   - `cardano-tx` — the signed tx CBOR the Orchestrator will hand to the facilitator.
   - `masumi-purchase` — seller terms from a Masumi `start_job` (agentIdentifier, amount, payByTime).
3. **Hire.** The Orchestrator creates a Guard Check Task with input `{mandateBundle, proposal}`.
4. **Check (guard-core).** In order, stop at first hard fail:
   1. Mandate signature valid (`COSE.SignData.verifyData`, `@evolution-sdk/evolution`).
   2. Signer address = `mandate.payer`.
   3. Mandate not expired; nonce not used before (store).
   4. Match fields: payee, asset unit, amount (exact), expiry (proposal deadline ≤ mandate expiry).
   5. For `cardano-tx`: decode tx, sum outputs to payee, check TTL ≤ expiry, and check that
      metadata label 674 holds the Mandate Digest (**SPIKE S1**).
   6. For a Masumi payee: registry lookup — agent `Online`, pricing matches.
5. **Verdict.** `APPROVE` or `REFUSE` + reason codes + Diff.
6. **Receipt.** Guard Receipt = `{verdict, diff, mandateDigest, proposalDigest, taskId, ts}`,
   signed by the Guard Key (CIP-8). Receipt text is the Task result.
7. **On chain.** Worker submits `submitResultHash = inputHash ‖ outputHash` (MIP-004) to MPS.
   The Receipt is now anchored on Cardano by Masumi's decision log.
8. **Pay or stop.** Orchestrator pays via x402 only on APPROVE. On REFUSE it stops and shows
   the Diff. No human is needed for the block.

## Masumi seller flow (per paid Task)

From `docs/research/MASUMI-DIGEST.md` §1 step 11:

```
poll event → request signed seller terms (SPIKE S2) → post masumiPayment on Task
→ wait FundsLocked → run Guard Check → save exact UTF-8 result
→ POST /payment/submit-result → complete Task → after unlockTime, auto-collect
```

**Idempotency.** Key every side effect by `{taskId, eventId, action}` in Postgres. A restart
must never run a Task twice, post `masumiPayment` twice, or submit a result twice. Judges
score this ("no repeated work, no double charge").

## Trust boundaries

- The Orchestrator is untrusted. It never holds the Guard Key. It cannot change a Mandate
  without breaking the signature.
- The Guard is advisory: it does not hold the payer's funds. The binding is that a correct
  Orchestrator pays only with an APPROVE Receipt, and the Receipt is public on chain, so a
  payment without a matching Receipt is visible to anyone.
- Stretch (not MVP): make the binding hard with an Aiken validator that releases funds only
  with a Guard signature over a matching Receipt. See `docs/DECISIONS.md` DEC-T07.

## Secrets

All in env, never in git. See `.env.example`. Separate keys for: Sokosumi coworker,
MPS admin, MPS runtime, Blockfrost, Guard Key, Orchestrator wallet, model provider.
