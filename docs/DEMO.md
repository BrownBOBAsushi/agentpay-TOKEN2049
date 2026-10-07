# DEMO — Script and scenarios

> Video limit: 3 minutes. Top 5 also pitch live on the TOKEN2049 stage. Write for both.

## Scenarios

| ID | Name | What happens | Shows |
|---|---|---|---|
| **S1** | Happy path | Human signs Mandate in Lace: pay the demo seller 2 tADA, void after 23:59 SGT. Orchestrator proposes exactly that. Guard: APPROVE. Orchestrator pays via x402. | No false positives. Fast. |
| **S2** | Web page injection | Same Mandate. The page the Orchestrator reads has hidden text: a second `PAYMENT-ENDPOINT:` line pointing to the attacker route (50 tADA to `addr_test1vqqgk3uy…`). Orchestrator proposes that. Guard: REFUSE, Diff on payee + amount. No money moves. | The star moment. No human needed. |
| S3 | Expired / replayed Mandate | Re-send S1's Mandate after expiry, or reuse its nonce. Guard: REFUSE `MANDATE_EXPIRED` / `NONCE_USED`. | Replay safety. (Show only if time.) |

## 3-minute video outline

| Time | Beat |
|---|---|
| 0:00–0:20 | Problem: agents hire agents on Masumi. Escrow covers "not delivered", not "paid the wrong agent". |
| 0:20–0:45 | Human signs a Mandate in Lace. Show the exact fields. |
| 0:45–1:15 | S1: Guard APPROVE → x402 payment → tx on Cardanoscan. |
| 1:15–2:00 | S2: show hidden text on page → Guard REFUSE → Diff table. "No human needed." |
| 2:00–2:30 | Proof: the Guard is a paid Coworker on Sokosumi; Receipt hash on chain via Masumi; collection tx. |
| 2:30–3:00 | Scale: any Masumi agent hires the Guard before `hire_agent` / `POST /purchase`. Next: on-chain vault. |

## Recording runbook (7 Oct, DEC-T14/T15)

**Order matters: record S2 before S1.** Both use the one Lace Mandate
(`src/guard/fixtures/bundle.wallet.json`). S1's APPROVE consumes its nonce (DEC-T11); S2 after S1 would be
refused only for `NONCE_REUSED` and lose the payee/amount Diff. S2 takes are unlimited; a second S1 take
needs a new Lace signature on `/mandate`.

orch prepares: `next start` on :3000, `npm run demo-seller` on :4021, a clean `runs/` journal, browser tabs.

| # | Screen | Action |
|---|---|---|
| 1 | `http://127.0.0.1:3000/` | Problem statement. |
| 2 | `/mandate` + Lace | Show the cheque fields: 2 tADA to the seller, void after 23:59 SGT. |
| 3 | `http://127.0.0.1:4021/offer/injected` (view source) | Show the hidden `PAYMENT-ENDPOINT` line. |
| 4 | Terminal | `npm run orchestrator -- --scenario S2 --mandate src/guard/fixtures/bundle.wallet.json` → REFUSE + Diff, no payment (~15 s). |
| 5 | `/receipt/<S2 taskId>` | RETURNED cheque, rings on payee + amount. |
| 6 | Terminal | Same command with `--scenario S1` → APPROVE → x402 pay → tx hash (~60–90 s; cut the wait). |
| 7 | `/receipt/<S1 taskId>` + Cardanoscan | PAID; tx on preprod. |
| 8 | `/receipt/01a110bb-e6aa-74a2-953c-269254af16ce` | Paid Coworker proof: escrow, result hash, collection. |
| 9 | Close | Scale + next steps. |

## Recording runbook v2 (7 Oct 15:30, live site + `/store`, DEC-T16)

Browser: `https://agentpay-guard-cardano.vercel.app`. Terminal: `~/Github/agentpay-demo` (`npm run demo-seller` in a
second window). Real hire + real payment stay in the terminal; the audience moment is `/store`.

| # | Screen | Action |
|---|---|---|
| 1 | `/` | "Tomorrow you'll tell your AI: buy me a latte." |
| 2 | `/mandate` (+ Lace) | The human signs once: 6.5 tADA to The Corner Store, latte, until 31 Dec. |
| 3 | `/store` | The latte page. Click **Reveal hidden text**: the attacker's comment (28.00 to "Evil Store"). |
| 4 | `/store` | **Send to my AI** → the AI obeys the page → real Guard check → RETURNED, rings on payee + amount, "No payment made". |
| 5 | `/store` | Edit 28.00 → 500, send again → REFUSE. Switch injection OFF, send → CLEARED (what you signed). |
| 6 | Terminal | `npm run orchestrator -- --scenario S2 --mandate src/guard/fixtures/bundle.wallet.json` → hired on Sokosumi → REFUSE. |
| 7 | Terminal | Same with `--scenario S1` → APPROVE → paid over x402 → tx hash. Open `/receipt/<taskId>` + Cardanoscan. |
| 8 | `/receipt/01a110bb-e6aa-74a2-953c-269254af16ce` | Paid Masumi Coworker: escrow, result hash on chain, collection. |
| 9 | Close | Any agent hires the Guard before it pays. Next: on-chain vault. |

Steps 6–7 use the market-data Mandate (`bundle.wallet.json`, valid to 23:59 SGT; S2 before S1).
