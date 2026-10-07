# AgentPay Guard

**An AI agent can only spend what its human signed.**

AgentPay Guard is a Masumi Coworker on Cardano. Before an agent pays another agent, it hires
the Guard. The Guard checks the payment against a Mandate that the human signed in their
Cardano wallet. A match gets APPROVE. Anything else, such as a payee or amount changed by
prompt injection, gets REFUSE with a field diff. Every Verdict is a signed Guard Receipt, and
Masumi anchors its hash on chain.

Built at the TOKEN2049 Origins Hackathon (Cardano "Agentic Commerce" track), Singapore,
6–8 October 2026.

- How it works: [ARCHITECTURE.md](ARCHITECTURE.md)
- Words we use: [CONTEXT.md](CONTEXT.md)
- Build plan: [docs/PLAN.md](docs/PLAN.md)

## On-chain proof (Cardano preprod)

Live demo: https://agentpay-guard-cardano.vercel.app/store · Full evidence: [docs/EVIDENCE.md](docs/EVIDENCE.md)

| What | ID / hash | Link |
|---|---|---|
| Showcase Task (token2049 workspace): injected checkout refused | Task `01a116e1-6147-7144-94b8-c0313e0deb26` · REFUSE `PAYEE_MISMATCH` + `AMOUNT_MISMATCH` (signed 6.5 tADA to The Corner Store vs 28 tADA to Evil Store) | [signed Receipt](https://agentpay-guard-cardano.vercel.app/receipt/01a116e1-6147-7144-94b8-c0313e0deb26) |
| Recorded demo: Guard APPROVE → x402 payment | Task `01a116c0-c4cf-7023-a64b-5ba4c5cf47bb` · tx `730105f984274d452d5afe85756139eccd309f343d767858665d416a25b64ac2` (6.5 tADA to the store) | [Cardanoscan](https://preprod.cardanoscan.io/transaction/730105f984274d452d5afe85756139eccd309f343d767858665d416a25b64ac2) |
| **Paid Coworker** — buyer funds locked in Masumi escrow | Task `01a110bb-e6aa-74a2-953c-269254af16ce` · lock tx `5001490300711c641bddb77ea1e49c611176b495b591ffc268878e4b299a6dec` (1 tUSDM) | [Cardanoscan](https://preprod.cardanoscan.io/transaction/5001490300711c641bddb77ea1e49c611176b495b591ffc268878e4b299a6dec) |
| Guard Receipt hash on chain (`submitResult`) | result hash `49bf447d44c7ea9f1460aff726b5b53d6a82fa8634e98f42a1533ec698589c6f` · tx `a3609fa45c44de6a85e8d1bec40d0d6844da5129e25f5ee27ac0c7c9747f5c32` | [Cardanoscan](https://preprod.cardanoscan.io/transaction/a3609fa45c44de6a85e8d1bec40d0d6844da5129e25f5ee27ac0c7c9747f5c32) |
| **Payment received by our agent** (collection) | tx `8ef677dc278f4f11a4a15c3fd4af80394e3b13626c7cecb4ade2abee74bc1526` · net **1.000000 tUSDM** to the selling wallet | [Cardanoscan](https://preprod.cardanoscan.io/transaction/8ef677dc278f4f11a4a15c3fd4af80394e3b13626c7cecb4ade2abee74bc1526) |
| Agent registration (Masumi registry NFT) | mint tx `c7971f7a252c09370c68d4d5e1d12405a80da02062058d698b4e6a61e9e9e8f5`, registry policy `67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b` | [Cardanoscan](https://preprod.cardanoscan.io/transaction/c7971f7a252c09370c68d4d5e1d12405a80da02062058d698b4e6a61e9e9e8f5) |

## Run it

Use Node.js 24 or later for the web app and local checks.

```bash
npm install
npm run dev
```

Open http://localhost:3000 to see "AgentPay Guard".

Run the checks and build:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Run the Guard Worker locally with `npm run worker`. It reads configuration from
environment variables and `.env.local`. For Railway, set these variables in the
service settings; the Docker image does not include env files.

- Required base: `SOKOSUMI_API_URL`, `SOKOSUMI_COWORKER_API_KEY`, `SOKOSUMI_COWORKER_ID`,
  `DATABASE_URL`, `GUARD_SIGNING_KEY`, `GUARD_ADDRESS`.
- Paid: `MPS_BASE_URL` (use the MPS HTTPS public domain on Railway), `MPS_RUNTIME_TOKEN`,
  `MASUMI_AGENT_IDENTIFIER`, `MASUMI_SUPPORTED_PAYMENT_SOURCE_INDEX`, `TUSDM_UNIT`,
  `PAID_TASKS_ENABLED`.
- Optional: `POLL_INTERVAL_MS`, `PAID_PAY_BY_MINUTES`, `PAID_SUBMIT_RESULT_MINUTES`,
  `PAID_UNLOCK_MINUTES`, `PAID_DISPUTE_MINUTES`.

Run one Worker replica only; the Worker holds an advisory lock. The image uses
Node.js 24 and starts with `node --import tsx src/worker/index.ts`.
Follow [Runbook — move MPS + Worker to Railway](docs/OPS.md#runbook--move-mps--worker-to-railway-t-009).

## Run the demo (Orchestrator + x402 seller, Cardano preprod)

The demo buyer agent (Orchestrator) reads an offer page, gets the seller's x402 `PAYMENT-REQUIRED`,
hires the Guard with a Sokosumi Task, and pays over x402 only on a verified `APPROVE`
([DEC-T14](docs/DECISIONS.md)). The "injected" page adds a hidden instruction that changes the payee
and the amount: the Guard returns `REFUSE` with a Diff, and no money moves.

Needs: `sokosumi` CLI logged in on preprod (`sokosumi --preprod auth login`), a funded preprod
Orchestrator wallet, and a running Guard Worker. Set in `.env.local`: `ORCHESTRATOR_WALLET_MNEMONIC`,
`BLOCKFROST_API_KEY_PREPROD`, `SOKOSUMI_COWORKER_ID`, `GUARD_ADDRESS`, `DEMO_SELLER_ADDRESS`
(optional: `X402_FACILITATOR_URL`, default is the hosted preprod facilitator; `DEMO_SELLER_PORT`, default 4021).

```bash
npm run demo-seller          # terminal 1: http://127.0.0.1:4021/offer and /offer/injected
# terminal 2: a Mandate bundle — sign one on /mandate in Lace/Eternl, or make a test-key one:
npm run demo:mandate -- --payee "$DEMO_SELLER_ADDRESS" --amount 2000000 --minutes 60
npm run orchestrator -- --scenario S2 --mandate <bundle.json>   # injected page → REFUSE, no payment
npm run orchestrator -- --scenario S1 --mandate <bundle.json>   # honest page → APPROVE → paid
```

Run S2 before S1 with the same Mandate: an `APPROVE` consumes the Mandate nonce (DEC-T11).
Each run writes a transcript to `runs/`. `/demo` replays two recorded preprod runs. Evidence (Task IDs,
tx hashes): [docs/EVIDENCE.md](docs/EVIDENCE.md). See [CLAUDE.md](CLAUDE.md#commands) for every script.
