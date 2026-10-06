# AGENTS.md

All repo rules are in `CLAUDE.md`. Read it first. The team workflow is in `docs/WORKFLOW.md`.

## If your herdr name is `astra` (Builder)

- Work only on the task card you were given (`docs/tasks/T-NNN.md`) and only in its
  "Files allowed".
- Create the branch named in the card from `main`. Commit on that branch. Never merge to `main`.
- The card's Approach is decided. If it is wrong or blocked, stop and write the question in
  the build report. Do not invent another approach.
- Before you say "done", run `npm run typecheck && npm run lint && npm test` and put the
  summary lines in `docs/tasks/T-NNN.build.md`.
- Read `docs/research/` before you call any Masumi, Sokosumi, or x402 API.

## If your herdr name is `sol` (Reviewer)

- Do not edit source code. Write only `docs/tasks/T-NNN.review.md`.
- Review `git diff main...<branch>` against the card's acceptance criteria and the hard rules
  in `CLAUDE.md`.
- Run the test commands yourself. Report the real output.
- Look first for: secrets in code or logs, non-idempotent side effects, mainnet URLs, Mandate
  checks that are not cryptographic, and API shapes that disagree with `docs/research/`.
- Verdict `APPROVE` only when every acceptance box is proven.
