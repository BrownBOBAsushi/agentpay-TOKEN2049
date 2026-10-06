# AgentPay Guard — Repo context for coding agents

## What this is

A Masumi Coworker on Cardano Preprod that checks an AI agent's payment against a
human-signed Mandate before the agent pays. Built at the TOKEN2049 Origins Hackathon,
Cardano "Agentic Commerce" track, 6–8 October 2026. Deadline: 7 Oct 23:59 SGT.

## Read first, in order

1. `CONTEXT.md` — the ubiquitous language. Use its words.
2. `ARCHITECTURE.md` — the parts and the Guard Check flow.
3. `docs/PLAN.md` — the current milestone, spikes, and cut list.
4. `docs/DECISIONS.md` — what is decided. Do not re-open a decision; add a new one.
5. `docs/WORKFLOW.md` — roles: you are `orch` (Claude), `astra` (Codex builder), or
   `sol` (Codex reviewer). Follow your role.
6. `docs/research/MASUMI-DIGEST.md`, `docs/research/X402-CARDANO-DIGEST.md` — API facts.
   Read these before you write code against Masumi, Sokosumi, or x402. Do not guess an API.
   Official links are in `docs/research/LINKS.md`. The organisers' Quickstart
   (https://www.masumi.network/token2049) wins when sources conflict.
7. `docs/OPS.md` — infra state, where things run, secrets map (no values), setup gotchas.
   `orch` owns it and updates it when infra changes. Every web or deploy task card must
   cite its "Vercel rule" (keep `agentpay-guard-cardano.vercel.app` and
   `/examples/guard-receipt-refuse.json` alive: the registry NFT points there).

## Stack

- TypeScript (strict), Node 24+
- Next.js (App Router) for `app/`; plain Node for `src/worker/`, `src/orchestrator/`
- `@x402/cardano` + `@evolution-sdk/evolution` (pin all `@x402/*` to one version)
- Masumi Payment Service (self-hosted), `sokosumi` CLI, Blockfrost preprod
- Postgres, vitest

## Hard rules

- **Built during the hackathon.** Write all code new here. Do not copy files from the old
  AgentPay repo (DEC-T08).
- **Preprod only.** Never use mainnet keys or mainnet URLs.
- **Never commit secrets.** Only `.env.example`. Never print a wallet mnemonic or key to logs.
- **Every side effect is idempotent**, keyed by `{taskId, eventId, action}`.
- **Mandate verification is cryptographic** (CIP-8), never a UI-only check.
- **"Done" needs evidence:** test output, a tx hash, or a URL. Otherwise say "in progress".
- Do not edit `.agents/` or `.claude/` unless the user asks.
- Write in ASD-STE100 Simplified Technical English.

## Skills and tools

- Masumi skill: `.agents/skills/masumi/` (installed). Use it for Masumi/Sokosumi API detail,
  but prefer the hackathon path in `docs/research/MASUMI-DIGEST.md` §0 when they conflict.
- Cardano dev skills (user installs): `/plugin marketplace add cardano-foundation/cardano-dev-skills`
  then `/plugin install cardano-dev-skills@cardano-dev-skills`.

## Commands

- `npm run dev` — Start the Next.js development server at http://localhost:3000.
- `npm run build` — Build the Next.js app for production.
- `npm run typecheck` — Check all TypeScript files without emitting code.
- `npm run lint` — Check files with ESLint; warnings fail the check.
- `npm test` — Run the Vitest test suite once.
- `npm run worker` — Run the empty Guard Worker entry file.
- `npm run orchestrator` — Run the empty Orchestrator entry file.
- `npm run demo-seller` — Run the empty demo-seller entry file.
