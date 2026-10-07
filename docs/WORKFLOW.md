# WORKFLOW — Orchestrator, Builder, Reviewer (herdr)

> Three agents in one herdr workspace. One writes code. One reviews. One decides.

## Roles

| Agent | herdr name | Kind | Does | Does NOT |
|---|---|---|---|---|
| **Orchestrator** | `orch` | claude | Owns `docs/PLAN.md`, `docs/DECISIONS.md`, task cards. Splits work, sends tasks, reads reviews, merges, talks to the human. | Write feature code (small doc/config fixes are OK). |
| **Builder** | `astra` | codex | Implements one task card on its branch. Runs tests. Writes a short build report. | Change scope, edit decisions, merge to `main`. |
| **Reviewer** | `sol` | codex | Reviews the branch diff against the task card and the hard rules. Writes a review file. | Edit code. Approve without running the tests. |

**Session 3 (7 Oct), user override:** `sol` (gpt-6.1-sol, high) is the **builder** and `astra`
(gpt-6-astra, medium) is the **reviewer**. Swap the two names in the table and the loop below.

The human does: account sign-ups, wallet signing, faucet claims, secrets, and final approval
of anything outward-facing (deploy to public URL, Sokosumi listing, submission).

## Files the agents share

- `docs/tasks/T-NNN.md` — task card, written by `orch`.
- `docs/tasks/T-NNN.build.md` — build report, written by `astra`.
- `docs/tasks/T-NNN.review.md` — review, written by `sol`.

### Task card template

```markdown
# T-NNN — <title>
Milestone: M? · Branch: feat/T-NNN-<slug> · Status: todo | building | review | changes | done
## Goal
<one paragraph; which CONTEXT.md terms apply>
## Approach (decided — builder implements, does not re-decide)
<2–5 sentences; cite docs/research/ sections for API facts>
## Files allowed
<paths>
## Acceptance criteria
- [ ] <check with an exact command, e.g. `npm test -- guard` passes>
- [ ] `npm run typecheck && npm run lint && npm test` green
## Out of scope
<what not to touch>
```

### Build report (≤ 15 lines)
What changed (file per change) · commands run + summary output lines · anything not done or
not verified · questions for `orch`.

### Review (≤ 20 lines)
Verdict: `APPROVE` | `CHANGES` · each finding as `file:line — problem — fix` ranked by severity ·
test commands re-run + result · hard-rule check (secrets, idempotency, preprod only, CIP-8).

## The loop

```
orch: write T-NNN card ──► astra: branch, build, test, build report
                                   │
orch: read report ◄────────────────┘
orch: ──► sol: review branch vs card ──► review file
orch: APPROVE → merge to main, mark done, next card
      CHANGES → send findings to astra (max 2 rounds, then orch decides or asks human)
```

Rules:
- One task in `building` at a time for `astra`. `sol` may review T-N while `astra` builds T-N+1.
- `orch` merges with `git merge --no-ff feat/T-NNN-*`. Never force-push. Never rewrite `main`.
- Every 3 hours `orch` updates `docs/PLAN.md` ticks with evidence and tells the human the
  status in 3 lines.
- When a spike (S1–S4) answers a question, `orch` records it as a new decision.

## herdr commands for `orch`

Run only inside herdr (`test "$HERDR_ENV" = 1`). Parse IDs from JSON; do not guess them.

```bash
# discover
herdr agent list
herdr pane list --workspace "$HERDR_WORKSPACE_ID"

# create panes for the two codex agents (once)
herdr pane split --current --direction right --cwd ~/Github/agentpay-TOKEN2049 --no-focus
herdr agent start astra --kind codex --pane <new-pane-id>
herdr pane split <astra-pane-id> --direction down --cwd ~/Github/agentpay-TOKEN2049 --no-focus
herdr agent start sol --kind codex --pane <new-pane-id>

# send work and wait
herdr agent prompt astra "Read AGENTS.md, then build docs/tasks/T-001.md. Write the build report file when done." --wait --timeout 1800000
herdr agent prompt sol "Read AGENTS.md, then review branch feat/T-001-* against docs/tasks/T-001.md. Write docs/tasks/T-001.review.md." --wait --timeout 900000

# read results
herdr agent read astra --source recent-unwrapped --lines 80
```

If an agent returns `blocked`, read it with `herdr agent read` and ask the human before you
answer an approval prompt. A timeout does not prove the prompt failed; read before you resend.
