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
| Paid Task ID | | |
| Payment tx | | |
| Result hash | | |
| Collection tx | | |
| Net tUSDM received | | |
