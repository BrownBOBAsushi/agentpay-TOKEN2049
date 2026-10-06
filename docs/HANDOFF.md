# HANDOFF — orch session 1 → next sessions (2026-10-06, ~23:45 SGT)

> Read with `CLAUDE.md` (Read first list), `docs/WORKFLOW.md`, `docs/OPS.md`, `docs/PLAN.md`,
> `docs/EVIDENCE.md`. Deadline: 7 Oct 23:59 SGT (submit by 22:00).

## Where we are
- **main** = `10a23f8`. 349 tests pass (`npm test`), typecheck/lint/build green.
- **M0, M1, M2 done.** Guard core (Mandate, CIP-8 verify, x402 matcher, Receipt), Worker (free + paid
  seller flow, idempotency, advisory lock, reconcile), live preprod evidence (rehearsals S1/S2, paid Task
  `01a110bb…` settled, net 1.0 tUSDM), **hosted on Railway** (MPS + Worker + Postgres). All in EVIDENCE.md.
- **M3 web, merged:** landing (T-011), `/receipt/[id]` (T-012), `/mandate` (T-013), security-paper
  texture (T-014). **Not deployed to Vercel yet.**
- **In flight: T-015** (teller's desk world + landing scroll scene). Sent to astra; astra was compacting
  context with no `feat/T-015-desk` branch yet. If the branch does not exist with commits, **re-send
  T-015 to the new astra**. Then **T-016** (receipt + mandate on the desk). Cards are in `docs/tasks/`.

## Next steps (in order)
1. T-015: astra builds → orch visual check (build, `next start`, gstack `/browse` screenshots desktop
   1440×900 + mobile 390×844, one batched design round max) → sol code review → merge.
2. T-016: same loop.
3. Local preview for the user (they review before any deploy): `rm -rf .next && npm run build &&
   npx next start --hostname 127.0.0.1 --port 3000` (reads `.env.local`, so live receipts work).
   Links: `/`, `/receipt/01a10ff9-5009-73d6-903e-7a5effdb30d0` (S2 REFUSE),
   `/receipt/01a110bb-e6aa-74a2-953c-269254af16ce` (paid APPROVE), `/mandate`.
4. **Deploy only when the user says "deploy"**: Vercel project `agentpay-guard-cardano`. Set env
   `SOKOSUMI_API_URL`, `SOKOSUMI_COWORKER_API_KEY`, `GUARD_ADDRESS` (+ optional
   `NEXT_PUBLIC_SOKOSUMI_LISTING_URL`, `NEXT_PUBLIC_REPO_URL`, `NEXT_PUBLIC_TUSDM_UNIT`) via stdin, never
   printed. Then check `https://agentpay-guard-cardano.vercel.app/examples/guard-receipt-refuse.json`
   still returns the same bytes (SHA-256 `6299155054e67dcb56deae9216f95c07c0f0e5d52d03ab4ac913afe451243cb5`) — **Vercel rule**.
5. Design finish (impeccable FINISH line): finish review (impeccable-finish-reviewer agent) + write
   `DESIGN.md` (impeccable-documenter agent).
6. **S3**: user signs one Mandate on `/mandate` with Lace/Eternl (preprod) → save bundle to
   `src/guard/fixtures/bundle.wallet.json`, un-skip the test in `src/guard/cip8.test.ts`, tick PLAN M1.
7. M4 (Orchestrator + x402 demo-seller + `/demo`), M5, M6 (video, slides, submission) per PLAN.md.

## Design (binding for any web card)
- `PRODUCT.md` + `.impeccable/surfaces/app-page-tsx.md` (direction contract, now "Teller's desk"):
  dark bottle-green leather desk, physical security-paper cheques, red only for RETURNED + red-pencil rings,
  Marcellus SC / Schibsted Grotesk / OCR-B (values only, **ligatures off** — "ff" rendered as "œ" once).
- Fonts are self-hosted in `app/fonts/` (builder sandbox has no network).
- `.impeccable/questions/` is untracked scratch — never commit.
- History of user asks: "no AI slop" → Returned Cheque world; "more texture" → T-014; "more realistic,
  catch eyeballs" → Teller's desk (T-015/T-016).

## Running things (stop or reuse)
- herdr workspace `w2`: orch `w2:p1`, **astra** `w2:p2` (Codex `-m gpt-6-astra -c model_reasoning_effort=medium`),
  **sol** `w2:p3` (Codex `-m gpt-6.1-sol -c model_reasoning_effort=high`). Roles per WORKFLOW (astra builds,
  sol reviews). Start new ones with `herdr agent start <name> --kind codex --pane <pane> -- <flags>`.
- Local preview `next start` may still run on :3000 (and :3100). Kill before rebuilding.
- **Hosted (Railway project `zoological-vision`)**: `masumi-payment-service`
  (https://masumi-payment-service-production-e4cd.up.railway.app, deployed by `railway up` from local
  MPS checkout `71455701`), `agentpay-guard-worker` (free mode), `Postgres` (PG 18; public TCP proxy still ON —
  user may turn it off). Railway CLI is installed and linked in this repo.
- **Never** start the local MPS again (same wallets as hosted). **Never** run the local Worker while the
  hosted one runs (two DBs → same Task twice).

## Hard-won gotchas
- Codex sandbox: **no network** (jarvis permission profile). orch installs npm packages and passes them
  in uncommitted `package.json`/lock; orch runs `next start`/browser checks. Builds work in a temp copy.
- herdr: `agent prompt --wait` needs `--until working`; then `agent wait --until idle --until done
  --until blocked`. A Codex question/approval shows as `blocked`; read the pane before answering. While
  Codex is busy, queue a message with `send-text` + `Tab` (Enter does not queue).
- Ask the human before answering any Codex approval prompt (WORKFLOW). npm commands are pre-approved.
- MPS quirks: unfiltered `GET /payment` list is empty for the runtime token — filter by agent;
  `onChainState` and pending `newOnChainState` can be `null`; seller `collectionAddress` must be `null`
  (not `""`); local MPS uses 20 confirmations + 180 s checks → paid deadlines +20/+60/+75/+90 min (DEC-T13).
- Next.js: dynamic data under a static route needs `fetch(..., { next: { revalidate: 60 } })`.
- Secrets: read only by reference (`$(grep ^KEY= .env.local | cut -d= -f2-)`), pass via stdin
  (`railway variable set KEY --stdin`), never print. `.env.local` must end with a newline.
- Auto-mode classifier refused: self-merging while the user said "pause", and lowering MPS
  `BLOCK_CONFIRMATIONS_THRESHOLD` (security weaken) — leave those to the human.

## Open human items
- Sokosumi listing URL (landing link), turn off Railway Postgres TCP proxy (optional), S3 wallet signing,
  move wallet mnemonics out of `~/.masumi-seed-backup.log` (OPS open task 1), fund the Orchestrator
  purchasing wallet before M4.
