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

OWN-WORLD: A teller's desk at night under one lamp: the page is a dark bottle-green leather blotter `#1d3b33` with leather grain, a tooled gilt double border `#b89b5e`, and a darker vignette `#13261f`; light text on the desk `#e6ede7` / `#c3d1c9`. On it lie physical cheques of security paper (rainbow tint sage `#dfe9e1` → `#e4ecef` → ochre `#efe6d4`, two-ink digest-seeded guilloche sage-teal `#7fa79c` + bronze `#c9b28a`, wave band, microprint, pantograph COPY on presented copies, engraved seal, grain), each with a perforated cheque-book stub, real layered shadow and a slight tilt. Ledger ink `#16303a` on paper. Red `#b3261e` is the teller's: RETURNED stamp and red-pencil rings only. A typed RETURN ITEM slip (OCR-B on bright slip paper `#f3f4ef`) is clipped on with a metal paper clip. Marcellus SC legends, Schibsted Grotesk prose, OCR-B values (no ligatures). (Raised 2026-10-06 at the user's request: "more realistic, catch people's eyes"; Teller's desk chosen.)

STORY: The visitor sees a signed cheque, watches an agent present a forged copy (other payee, higher amount) that comes back RETURNED, understands the Guard checks the signature and every field, and acts: sign their own Mandate or open a real refusal Receipt.

FIRST VIEWPORT: The dark desk fills the screen; top-left, light legend "AgentPay Guard" and the promise "An agent can only spend what its human signed." at display size on the leather. The signed cheque lies across the lower two-thirds, tilted −1.2°, with its stub, lit from the top-left, real S1 values. Primary "Sign a Mandate" and secondary "Read a real refusal" sit on the desk beside the cheque. Scrolling plays the one choreographed moment: the agent's forged copy slides over the signed cheque (+2.5°), red-pencil rings draw around the changed payee and amount, RETURNED slams, the RETURN ITEM slip clips on.

FORM: Returned Cheque, my top-ranked grounded candidate (#1 of 7), chosen over the roll by the user; seed key 05b8e245.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Signature interaction

The guilloche is drawn procedurally from the Mandate Digest: change one field and the safety pattern changes. On `/mandate` it redraws as the human edits; on `/receipt` the signed and presented patterns sit side by side and visibly differ when the proposal was forged.

## Unresolved

- `/receipt` data source needs `SOKOSUMI_COWORKER_API_KEY` in Vercel env (human).
- Real-wallet signing shape (SPIKE S3) is unproven until a human signs in Lace or Eternl.
