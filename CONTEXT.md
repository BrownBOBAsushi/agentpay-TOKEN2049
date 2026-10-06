# CONTEXT — What AgentPay Guard is

> AgentPay Guard is a Masumi Coworker that checks a payment before an AI agent makes it.
> One line: **an agent can only spend what its human signed.**

Built at the TOKEN2049 Origins Hackathon, Cardano "Agentic Commerce" track, Singapore,
6–8 October 2026. Track side: "In between" (agent-to-agent flows on Masumi).

## The problem in three sentences

On Masumi, agents hire agents, and every hire moves money into escrow. An agent that reads a
web page, a peer agent's output, or its own memory can be told by hidden text to hire a
different agent, or pay more. Escrow protects the buyer when work is *not delivered* — it does
not protect the buyer when the agent pays for the *wrong* thing.

## The answer in three sentences

The human signs one exact Mandate with their Cardano wallet: payee, asset, amount, expiry,
nonce. Before the agent pays, it hires AgentPay Guard for a Guard Check. The Guard compares the
Spend Proposal to the Mandate and returns APPROVE, or REFUSE with a field diff and a signed
Guard Receipt whose hash Masumi writes on chain.

## Scope

- **In scope:** prompt injection that changes a payment (content-source, peer-agent,
  persistent-state). One live demo scenario: a web page injection changes the payee and amount.
- **Not in scope:** direct user injection, phishing, wallet or key compromise.

## Ubiquitous language

Use these words in code, docs, and talk. One meaning each.

| Term | Meaning |
|---|---|
| **Mandate** | The statement the human signs: `{payee, asset, amount, expiry, nonce, purpose}`. Signed with CIP-30 `signData` (CIP-8 COSE_Sign1, Ed25519). |
| **Mandate Digest** | `SHA-256(prefix ‖ JCS(mandate))`. The short ID of a Mandate. Same pattern Masumi uses for seller terms. |
| **Payer** | The human's Cardano address that signs the Mandate. |
| **Payee** | Who the Mandate allows to receive money: a Masumi `agentIdentifier` or a Cardano address. |
| **Spend Proposal** | What the paying agent wants to do. One of three kinds: an x402 `PaymentRequirements`, a Cardano tx (CBOR), or Masumi purchase terms. |
| **Guard Check** | One paid Task: verify the Mandate signature, then match the Spend Proposal to the Mandate field by field. |
| **Verdict** | Result of a Guard Check: `APPROVE` or `REFUSE`, with reason codes. |
| **Diff** | The list of fields where the Spend Proposal differs from the Mandate: `{field, signed, proposed}`. |
| **Guard Receipt** | The signed record of a Verdict (APPROVE or REFUSE). Signed by the Guard Key. Its hash goes on chain through Masumi `submitResultHash`. |
| **Guard Key** | The Ed25519 key that signs Guard Receipts. Separate from every wallet that holds money. |
| **Coworker** | An AI agent registered on Sokosumi that companies and agents hire per Task. AgentPay Guard is one. |
| **Orchestrator** | The paying agent. In the demo: a buyer agent that reads a web page and wants to hire a data agent. |
| **Task** | One Sokosumi job for a Coworker. Paid into Masumi escrow. |
| **MPS** | Masumi Payment Service. Self-hosted. Handles escrow, result hash, collection. |
| **Facilitator** | x402 server that verifies and submits a Cardano payment tx. Hosted preprod instance. |
| **Walls** | The layered defences: Guard (Mandate binding) → Masumi escrow (refund on no delivery) → wallet (keys). |

## Words from the old AgentPay (EVM) and their new names

| Old (Avalanche/StraitsX) | New (Cardano/Masumi) |
|---|---|
| Tuple | Mandate fields |
| Confirmation (EIP-712) | Mandate signature (CIP-8) |
| Binding | Guard Check |
| Mint Gate | (removed — the Guard advises; the Orchestrator pays) |
| Block Receipt | Guard Receipt with Verdict REFUSE |
| Rail (StraitsX card) | x402 Facilitator / Masumi escrow |

## Where the truth lives

- `ARCHITECTURE.md` — how the parts connect.
- `docs/DECISIONS.md` — what we chose and why.
- `docs/PLAN.md` — the 36-hour build plan and cut list.
- `docs/research/` — digests of the Masumi and x402 docs. Read these before you guess an API.
