# HANDOFF — orch session 3, evening (2026-10-07 ~19:50 SGT)

- Live: https://agentpay-guard-cardano.vercel.app — `/store` one-line flow (hire Guard on Sokosumi) and the
  private live pay mode (user holds the link; key in `.env.local` `STORE_LIVE_KEY`). Evidence: EVIDENCE "/store live".
- Branch `release/m4-demo` = PR #2 (open; **user merges** — JARVIS invariant: no AI push to main). Deployed from it.
- Agents: sol + sol2 builders, astra reviewer. sol2's folder: `~/Github/agentpay-sol2` (own worktree; Codex sandbox
  cannot commit there — orch commits). T-023 round 2 (`0a58ed8`, request budgets + tx-hash completion) under
  astra review; **deploy it only after the user finishes recording**.
- User: recording the video now (script in chat; runbook `docs/DEMO.md`), then slides + submission (write-up
  `docs/WRITEUP.md`). Open: Sokosumi listing URL, event workspace ID, move seeds out of `~/.masumi-seed-backup.log`.

## Earlier: orch session 3 (2026-10-07, ~13:45 SGT)

> Session 3 status (supersedes "Where we are" / "Next steps" below where they conflict).
- Roles this session: **sol builds, astra reviews** (user override, WORKFLOW).
- **M4 done**: T-017 (seller + Orchestrator), T-019 (wait for chain), T-018 (`/demo`) all astra APPROVE and
  merged locally; S3 done with a real Lace bundle (DEC-T15). 431 tests. Evidence: EVIDENCE.md "M4".
- **JARVIS invariant: no AI push to main.** All work is on branch `release/m4-demo` → **PR #1**
  (https://github.com/BrownBOBAsushi/agentpay-TOKEN2049/pull/1). **The user merges it.** Local `main`
  (worktree `scratchpad/wt-main`) = `0c3fef5`; the PR branch adds `vercel.json` + docs.
- **Deployed** to Vercel production (user said "deploy"): all routes 200, live receipts load, Vercel rule OK.
- **User still to do:** record the video (runbook `docs/DEMO.md`; recording folder `~/Github/agentpay-demo`,
  Lace Mandate valid to 23:59 SGT, run S2 before S1), merge PR #1, slides, submit (write-up draft
  `docs/WRITEUP.md`), Sokosumi listing URL + event workspace ID, move seeds out of `~/.masumi-seed-backup.log`.
- After recording: optionally copy the user's real S1/S2 transcripts from `~/Github/agentpay-demo/runs/` to
  `public/demo-runs/` and redeploy (current ones are real preprod rehearsal runs with a test-key Mandate).
- Auto mode: a safety check started refusing actions mid-session; default permission mode worked.

## Previous: orch session 2 → session 3 (2026-10-07, morning SGT)

> Read with `CLAUDE.md` (Read first list), `docs/WORKFLOW.md`, `docs/OPS.md`, `docs/PLAN.md`,
> `docs/EVIDENCE.md`. Deadline: **7 Oct 23:59 SGT (submit by 22:00)**.
> State at handoff: **full shutdown** (user's Mac was locked for a quiz). No servers, no Codex
> agents, no browse daemon run. Everything below must be started again.

## Where we are
- **main** = `605c99b` + this docs commit. **362 tests pass, 1 skipped**; typecheck, lint and
  `npm run build` green. Registry example SHA-256 still `6299155…3cb5` (checked locally).
- **M0, M1, M2 done.** Guard core (Mandate, CIP-8 verify, x402 matcher, Receipt), Worker (free + paid
  seller flow, idempotency, advisory lock, reconcile), live preprod evidence (rehearsals S1/S2, paid Task
  `01a110bb…` settled, net 1.0 tUSDM), **hosted on Railway** (MPS + Worker + Postgres). All in EVIDENCE.md.
- **M3 done (local).** Landing (T-011), `/receipt/[id]` (T-012), `/mandate` (T-013), security paper
  (T-014), teller's desk + landing scroll scene (T-015, merged `91ff0db`), receipt + mandate on the desk
  (T-016, merged `605c99b`). Each: orch browser check 1440×900 + 390×844 PASS and sol APPROVE
  (`docs/tasks/T-01[56].design-review.md`, `*.review.md`). **Not deployed to Vercel.**
- **User rules (7 Oct), still in force:** no deploy until the user says "deploy"; **decline every
  Codex approval prompt** (Esc, then send the instruction as a normal prompt); never spend paid credit or
  overage for Claude or Codex — stop if usage runs out.

## Next steps (in order)
1. Restart the team (see "Start-up" below). Ask the user how much time is left before 22:00.
2. **Local preview for the user** (they review before any deploy): `rm -rf .next && npm run build &&
   npx next start --hostname 127.0.0.1 --port 3000` (reads `.env.local`, so live receipts work).
   Links: `/`, `/receipt/01a10ff9-5009-73d6-903e-7a5effdb30d0` (S2 REFUSE),
   `/receipt/01a110bb-e6aa-74a2-953c-269254af16ce` (paid APPROVE), `/mandate`.
3. **User items** (ask, do not do): S3 wallet signing on `/mandate` (Lace/Eternl, preprod) → save
   bundle to `src/guard/fixtures/bundle.wallet.json`, un-skip the test in `src/guard/cip8.test.ts`, tick
   PLAN M1; fund the Orchestrator purchasing wallet (M4); Sokosumi listing URL.
4. **M4** (Orchestrator + x402 demo-seller + `/demo`) per PLAN.md. Write cards T-017+ first; parts that
   need the funded wallet wait for the user. Use the PLAN cut list if late.
5. **Deploy only when the user says "deploy"**: Vercel project `agentpay-guard-cardano`. Set env
   `SOKOSUMI_API_URL`, `SOKOSUMI_COWORKER_API_KEY`, `GUARD_ADDRESS` (+ optional
   `NEXT_PUBLIC_SOKOSUMI_LISTING_URL`, `NEXT_PUBLIC_REPO_URL`, `NEXT_PUBLIC_TUSDM_UNIT`) via stdin, never
   printed. Then check `https://agentpay-guard-cardano.vercel.app/examples/guard-receipt-refuse.json`
   still returns SHA-256 `6299155054e67dcb56deae9216f95c07c0f0e5d52d03ab4ac913afe451243cb5` — **Vercel rule**.
6. Optional if time: design finish review (impeccable-finish-reviewer agent) + `DESIGN.md`
   (impeccable-documenter agent).
7. M5 (event run, evidence), M6 (video, slides, submission — user records and submits).

## Start-up (fresh session)
- `test "$HERDR_ENV" = 1`. `herdr agent list` / `herdr pane list --workspace "$HERDR_WORKSPACE_ID"`;
  parse pane IDs from JSON. If w2 panes are gone, split new ones (WORKFLOW "herdr commands").
- `herdr agent start astra --kind codex --pane <p2> -- -m gpt-6-astra -c model_reasoning_effort=medium`
- `herdr agent start sol --kind codex --pane <p3> -- -m gpt-6.1-sol -c model_reasoning_effort=high`
- Check `ls -l node_modules/.bin/next` is a symlink; if not: `rm -rf node_modules/.bin && npm rebuild`.
- Railway services keep running while the Mac is off (hosted); nothing local to restart there.

## Design (binding for any web card)
- `PRODUCT.md` + `.impeccable/surfaces/app-page-tsx.md` (direction contract "Teller's desk"):
  dark bottle-green leather desk, physical security-paper cheques, red only for RETURNED + red-pencil
  ellipse rings, Marcellus SC / Schibsted Grotesk / OCR-B (values only, **ligatures off**).
- Fonts are self-hosted in `app/fonts/` (builder sandbox has no network).
- `.impeccable/questions/` is untracked scratch — never commit.
- History of user asks: "no AI slop" → Returned Cheque world; "more texture" → T-014; "more realistic,
  catch eyeballs" → Teller's desk (T-015/T-016).

## Hosted (keep)
- **Railway project `zoological-vision`**: `masumi-payment-service`
  (https://masumi-payment-service-production-e4cd.up.railway.app, deployed by `railway up` from local
  MPS checkout `71455701`), `agentpay-guard-worker` (free mode), `Postgres` (PG 18; public TCP proxy still
  ON — user may turn it off). Railway CLI is installed and linked in this repo.
- **Never** start the local MPS again (same wallets as hosted). **Never** run the local Worker while the
  hosted one runs (two DBs → same Task twice).

## Hard-won gotchas
- Codex sandbox: **no network** (jarvis permission profile). orch installs npm packages and passes them
  in uncommitted `package.json`/lock; orch runs `npm run build`, `next start` and all browser checks.
- Codex keeps asking approval to start `next dev/start`, `rm -rf .next`, or clean temp dirs. Every
  prompt to astra/sol must say: "no servers, no approval requests, no writes to node_modules or repo
  `.next`; orch builds and runs browser checks." With this line T-016 ran with zero prompts.
  T-015 staging copies once replaced `node_modules/.bin` symlinks with plain files (`Cannot find module
  '../server/require-hook'`) — fix: `rm -rf node_modules/.bin && npm rebuild`.
- herdr: `agent prompt --wait` needs `--until working`; then `agent wait --until idle --until done
  --until blocked`. A Codex approval shows as `blocked`; read the pane (`--source visible`). While Codex
  is busy, queue a message with `pane send-text` + `Tab` (may need Tab twice; Enter does not queue).
  Sending `/new` and a prompt back-to-back can drop the prompt — check the pane after `/new`.
- Background waits in Claude Code die at their time limit; a killed wait does not mean the agent stopped.
- In zsh do not name a loop variable `path` (it overwrites PATH).
- MPS quirks: unfiltered `GET /payment` list is empty for the runtime token — filter by agent;
  `onChainState` and pending `newOnChainState` can be `null`; seller `collectionAddress` must be `null`
  (not `""`); local MPS uses 20 confirmations + 180 s checks → paid deadlines +20/+60/+75/+90 min (DEC-T13).
- Next.js: dynamic data under a static route needs `fetch(..., { next: { revalidate: 60 } })`.
- Secrets: read only by reference (`$(grep ^KEY= .env.local | cut -d= -f2-)`), pass via stdin
  (`railway variable set KEY --stdin`), never print. `.env.local` must end with a newline.
- Auto-mode classifier refused: self-merging while the user said "pause", and lowering MPS
  `BLOCK_CONFIRMATIONS_THRESHOLD` (security weaken) — leave those to the human.

## Open human items
- S3 wallet signing, fund the Orchestrator purchasing wallet (M4), Sokosumi listing URL, "deploy" go-ahead,
  move wallet mnemonics out of `~/.masumi-seed-backup.log` (OPS open task 1) before submission,
  optional: turn off Railway Postgres TCP proxy. M6: record video, submit.

## Prompt for the next fresh session (paste as the first message)
```
You are orch. Read CLAUDE.md, then docs/HANDOFF.md, then docs/WORKFLOW.md. Check HERDR_ENV=1.
Everything was shut down (Mac locked). Start fresh Codex agents astra (gpt-6-astra, medium) and sol
(gpt-6.1-sol, high) in panes w2:p2 / w2:p3 (create panes if missing). Rules still in force: no deploy
until I say "deploy", decline every Codex approval prompt, never spend paid credit. Resume from
"Next steps" in HANDOFF.md: build the local preview for me first, then M4. Ask me for S3 signing and
wallet funding when you need them.
```
