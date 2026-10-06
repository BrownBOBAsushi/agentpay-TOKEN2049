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

## Run it

Use Node.js 24 or later.

```bash
npm install
npm run dev
```

Open http://localhost:3000 to see "AgentPay Guard".

Run the checks and build:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

`npm run worker`, `npm run orchestrator`, and `npm run demo-seller` run empty
entry files. They exit without taking action. See [CLAUDE.md](CLAUDE.md#commands)
for every script.
