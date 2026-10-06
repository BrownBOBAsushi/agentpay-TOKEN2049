---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/mandate/page.tsx","app/receipt/[id]/page.tsx"]
---

# Surface brief — AgentPay Guard web (M3)

Scope: landing `/` (Persuade), `/receipt/[id]` (Read), `/mandate` (Operate). One visual world.
Audience: judges in a 3-minute video first, agent owners signing Mandates second. Receipts are public.
Proof on hand: real preprod Tasks and tx hashes in `docs/EVIDENCE.md` (S2 REFUSE `01a10ff9-5009-73d6-903e-7a5effdb30d0`, paid S1 `01a110bb-e6aa-74a2-953c-269254af16ce`). Nothing invented.
Constraint: `/examples/guard-receipt-refuse.json` stays byte-identical at that path (Vercel rule, `docs/OPS.md`).
Build path: code-led (no image generation on this machine).

## Direction contract

THESIS: A Mandate is a cheque the human signed for one payee, one amount, until one date. The agent presents it; the Guard clears it or returns it stamped with reason codes. Refuses the category default: dark crypto dashboard, shield icon, glowing badges.

OWN-WORLD: Safety-paper field (blue-grey `#e4ecef`) carrying a guilloche rosette generated from the Mandate Digest, deep ledger ink `#16303a`, guilloche line `#9db7c2`, return-stamp red `#b3261e` used only for REFUSE marks. Engraved wide capitals (Marcellus SC) for printed legends, Schibsted Grotesk for prose, OCR-B for every value, digest, and hash. Components are cheque parts: payee line, amount box, memo line, VOID AFTER date, signature line, MICR-style bottom line, rubber stamps, perforated PAID cancellation.

STORY: The visitor sees a signed cheque, watches an agent present a forged copy (other payee, higher amount) that comes back RETURNED, understands the Guard checks the signature and every field, and acts: sign their own Mandate or open a real refusal Receipt.

FIRST VIEWPORT: One full-width cheque fills the first screen (about 2.35:1 on desktop, stacked on mobile). Printed legend top-left: "AgentPay Guard" in engraved caps, and under it at display size "An agent can only spend what its human signed." Payee line, amount box, memo, VOID AFTER, the CIP-8 signature hex on the signature line, MICR line along the bottom: all real S1 values. Actions bottom-right on the cheque: primary "Sign a Mandate", secondary "Read a real refusal". Second screen: the agent's presented copy with the RETURNED stamp pressing onto it (the one authored motion).

FORM: Returned Cheque, my top-ranked grounded candidate (#1 of 7), chosen over the roll by the user; seed key 05b8e245.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction

The guilloche is drawn procedurally from the Mandate Digest: change one field and the safety pattern changes. On `/mandate` it redraws as the human edits; on `/receipt` the signed and presented patterns sit side by side and visibly differ when the proposal was forged.

## Unresolved

- `/receipt` data source needs `SOKOSUMI_COWORKER_API_KEY` in Vercel env (human).
- Real-wallet signing shape (SPIKE S3) is unproven until a human signs in Lace or Eternl.
