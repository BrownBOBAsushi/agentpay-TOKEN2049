# EVIDENCE — IDs, tx hashes, links

> Non-secret identifiers only. Never put keys, tokens, or mnemonics here.
> `docs/SUBMISSION.md` needs every row below.

## Sokosumi (preprod)

| Item | Value | Date |
|---|---|---|
| User ID | `01a10f4e-33fd-7317-bf31-8f4106b646d6` | 2026-10-06 |
| Vendor | AgentPay · slug `agentpay-guard` · `01a10f51-8397-7168-9d1b-d05324dc7119` | 2026-10-06 11:46 SGT |
| Coworker | AgentPay Guard · capability `tasks` · `01a10f51-9560-7687-8f44-08fab5311181` | 2026-10-06 11:46 SGT |
| Personal Workspace | `01a10f4e-4ac6-70dd-b20d-931274403a72` · access GRANTED | 2026-10-06 |
| Event organization | TOKEN2049 Origins Hackathon 2026 · `01a109d1-32a9-71a3-a0e3-658b2a7987cd` · slug `token2049-origins-hackathon-2026-nws2r7` | — |
| Event workspace | `01a109d1-32c8-735a-b148-d1b0b71abbb9` · access **PENDING** (requested 2026-10-06 ~11:48 SGT) | — |

## Masumi (preprod)

| Item | Value |
|---|---|
| Registry request | MPS id `cmuw61ml50000ovxi9wfqlkk2` · Standard · Dynamic pricing · requested 2026-10-06 12:15 SGT |
| apiBaseUrl (immutable in NFT) | https://agentpay-guard-cardano.vercel.app (Vercel project `agentpay-guard-cardano`) |
| Example output (in NFT) | https://agentpay-guard-cardano.vercel.app/examples/guard-receipt-refuse.json — keep this URL alive |
| agentIdentifier | `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b10907ca2791620d29e71245e18ae61554eb1c9920ff5d31dfb5feb3376000000` · **RegistrationConfirmed** 2026-10-06 12:19 SGT |
| Registry policyId | `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b` |
| Registration mint tx | `c7971f7a252c09370c68d4d5e1d12405a80da02062058d698b4e6a61e9e9e8f5` · https://preprod.cardanoscan.io/transaction/c7971f7a252c09370c68d4d5e1d12405a80da02062058d698b4e6a61e9e9e8f5 |
| Payment source | `Web3CardanoV2`, Preprod (local MPS :3012, seeded 2026-10-06 12:04 SGT) |
| Selling wallet address | `addr_test1qzh3ask7dqdqtvuq4t32zdvl2qu9znyym570qmwl0agcxf2q959g50wgvmjle95dy09656vkhz4qvqmvh02k6d7xvpcsct29t8` |
| Selling wallet vkey | `af1ec2de681a05b380aae2a1359f5038514c84dd3cf06ddf7f518325` |
| Purchasing wallet address | `addr_test1qq33kwprhpzx26hnhm2c92w80gr4fglylme7vu5vj0aj4ldq932w6605ug0pc4te2ae9pn4tynxmjxjc8xnv2ehtp9gsghzlc7` |
| Smart contract address | `addr_test1wzs4e6wc95hkwezlccjw9mdvq0r0rsgx6zk34avptga3ftgn37w4g` |

## Tasks and transactions

| Item | Value | Explorer |
|---|---|---|
| Rehearsal Task ID (S1, match) | `01a10ff8-7fe1-7189-bb49-36777acc73cf` · COMPLETED · APPROVE Receipt, `verifyReceipt` true · sha256(result) `ecddae7d6a5ca2444c573cea9c73782ac0ac286b1345f9ef209150c9582f0a20` · 2026-10-06 | Core `GET /v1/tasks/{id}/events` |
| Rehearsal Task ID (S2, injection) | `01a10ff9-5009-73d6-903e-7a5effdb30d0` · COMPLETED · REFUSE `PAYEE_MISMATCH`+`AMOUNT_MISMATCH`, 2-field Diff, `verifyReceipt` true · sha256(result) `fb5b5fbe1e76db3ec14f1ee82d8d70cc73a51cc0f4975aeb033bf7bddd092693` · 2026-10-06 | Core `GET /v1/tasks/{id}/events` |
| Restart idempotency | Worker stopped and restarted after both Tasks: each still `CREATED → READY → RUNNING → COMPLETED` (one RUNNING, one COMPLETED); 6 `side_effect` rows unchanged | local Postgres |
| Guard address (Receipt signer, holds no funds) | `addr_test1vq0v5s74k40pqnpqqfqkmkyaez8wh4fraq6vex69cly6krqvq9qx4` | |
| Paid Task attempt 1 (failed) | `01a1106d-916d-70dd-9798-95c556a24303` · MPS `POST /payment` HTTP 400 (empty-string seller collectionAddress); nothing created; fixed by human PATCH 09:0x UTC | — |
| Paid Task attempt 2 (failed) | `01a11072-5686-778f-a89b-65066d640295` · terms + masumiPayment OK (Core tx `01a11072-d814-772f-8bc5-442e59d99a4f`, 100 credits); buyer lock tx `38ff135b99952146a6c268e4cd1cc106f0c646587bf95b45bb89050d388b1bfc` 09:05:05 UTC block 5260035 (1 tUSDM, our inputHash); MPS timed out before 20 confirmations → `FundsOrDatumInvalid` (DEC-T13). No result submitted; buyer refund path applies | https://preprod.cardanoscan.io/transaction/38ff135b99952146a6c268e4cd1cc106f0c646587bf95b45bb89050d388b1bfc |
| Worker lock on real Postgres (T-010) | 2026-10-06: Worker holds 1 advisory lock; 2nd Worker → `worker_failed LockError`; reconcile while Worker up → `worker-running`; after stop → 0 locks; reconcile then → `not-pending` and releases | local `masumi-pg`, `pg_locks` |
| Hosted rehearsal (Railway, laptop Worker + MPS stopped) | `01a1114c-d346-7453-b78e-fda18965176b` · created 13:00:10, COMPLETED 13:00:21 UTC 2026-10-06 · APPROVE Receipt, `verifyReceipt` true · Railway `agentpay-guard-worker` log: `start`/`check`/`complete` for this Task ID · hosted MPS `https://masumi-payment-service-production-e4cd.up.railway.app` health ok, same selling wallet + registration + payment history after restore | Core `GET /v1/tasks/{id}/events`, `railway logs` |
| Paid Task ID | `01a110bb-e6aa-74a2-953c-269254af16ce` · COMPLETED 10:49 UTC 2026-10-06 · APPROVE Guard Receipt, `verifyReceipt` true · all 6 side effects once | Core `GET /v1/tasks/{id}/events` |
| Payment (escrow lock) tx | `5001490300711c641bddb77ea1e49c611176b495b591ffc268878e4b299a6dec` · Confirmed FundsLocked · 1 tUSDM | https://preprod.cardanoscan.io/transaction/5001490300711c641bddb77ea1e49c611176b495b591ffc268878e4b299a6dec |
| Result hash | `49bf447d44c7ea9f1460aff726b5b53d6a82fa8634e98f42a1533ec698589c6f` = sha256(COMPLETED result) = MPS on-chain resultHash · result tx `a3609fa45c44de6a85e8d1bec40d0d6844da5129e25f5ee27ac0c7c9747f5c32` Confirmed ResultSubmitted (submitted 10:37, deadline 11:22) | https://preprod.cardanoscan.io/transaction/a3609fa45c44de6a85e8d1bec40d0d6844da5129e25f5ee27ac0c7c9747f5c32 |
| Collection tx | `8ef677dc278f4f11a4a15c3fd4af80394e3b13626c7cecb4ade2abee74bc1526` · block 5260473 · 11:48:28 UTC · MPS auto-withdraw after unlock 11:37 · Core receipt `Withdrawn`, `settled: true`, same txHash | https://preprod.cardanoscan.io/transaction/8ef677dc278f4f11a4a15c3fd4af80394e3b13626c7cecb4ade2abee74bc1526 |
| Net tUSDM received | **1.000000 tUSDM** (1000000 atomic, unit `16a55b2a…0014df10745553444d`) at selling address `addr_test1qzh3ask7…ct29t8`, measured as outputs − inputs in the collection tx via Blockfrost; seller net lovelace −3638695 (tx fee 673175) | Blockfrost `GET /txs/{hash}/utxos` |

## M4 — Orchestrator + x402 demo (preprod, 2026-10-07, test-key Mandates)

Orchestrator wallet `addr_test1qrakfmhm…lsvx3jy5` (faucet tx `995948f9fdbffb815183b0eed65e040ac8f286ce5f07bfe7a2f237162103e934`,
10 000 tADA). Seller = `DEMO_SELLER_ADDRESS` (selling wallet `addr_test1qzh3ask7…ct29t8`). Hosted x402 facilitator
`https://x402.preprod.dev.ecosyseng.cf-deployments.org`. Guard = hosted Worker (free Task).

| Item | Value | Verified by |
|---|---|---|
| S2 injection (run 1) | Task `01a1147b-20bd-726b-a64c-db07a570e689` · REFUSE `PAYEE_MISMATCH`+`AMOUNT_MISMATCH` (2 000 000 → 50 000 000 lovelace, attacker `addr_test1vqqgk3uy…kz22us`) · Receipt trusted · no payment · 15 s | Orchestrator log, `sokosumi tasks events` |
| S1 honest (run 1) | Task `01a1147b-73fe-726a-8742-cfc609bc2daa` · APPROVE trusted · tx `0a879641dc19c74f92a95fb6db081fbfdb7fe72126a0a0e7df1410a2d61221b7` (block 5262997, 2 000 000 lovelace to seller, one tx) · recorded `confirmed-on-chain` on resume after T-017 fix | Blockfrost `GET /txs/{hash}/utxos`; https://preprod.cardanoscan.io/transaction/0a879641dc19c74f92a95fb6db081fbfdb7fe72126a0a0e7df1410a2d61221b7 |
| S2 injection (rehearsal 2) | Task `01a11491-13d8-7515-bfae-584acd44730d` · REFUSE payee + amount · no payment · 11.7 s | Orchestrator log |
| S1 honest (rehearsal 2) | Task `01a11491-3fab-76a9-b0b8-df7cce02ef17` · APPROVE · tx `37e05757f34867f5b55e5c2dd03fbfce1118247a3ebe3d8e005bf275c9bd550a` (block 5263054, 04:15:04 UTC) · first run stopped at ~62 s before settle (T-019), resume recorded `confirmed-on-chain` | https://preprod.cardanoscan.io/transaction/37e05757f34867f5b55e5c2dd03fbfce1118247a3ebe3d8e005bf275c9bd550a |
| Real wallet Mandate (S3) | Lace preprod, payer `addr_test1qprr4fdz…ets72`, nonce `d14e4b3e…8c68c1`, `verifyMandate` ok (DEC-T15) — reserved for the recorded S1 run | `src/guard/cip8.test.ts` |
