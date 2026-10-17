# Initiative: Documentation cleanup

Status: Active

Branch: `docs/cleanup`. One commit per step, one PR at the end.

---

## Goal

Bring every doc back in line with the code after a few months of drift:
remove outdated, wrong, duplicated or misplaced content, and make the
agent-facing docs trustworthy again.

## Hand-off protocol

Every step writes its output to a file in this folder before it is
considered done. A new session resumes by reading, in order:

1. this file (decisions + step status),
2. `audit.md` (the findings list — the work queue for steps 3–5),
3. any `step-N-*.md` notes left by the last step in progress.

Update the step checklist below as steps start (`[~]`) and finish (`[x]`).

## Decisions (made 2026-10-17)

| # | Question | Decision |
|---|---|---|
| D1 | Lua exporter | Gone for good — the `--dump-data` export has everything. Delete `spec/lua-export.md` and every reference to the Lua mod. |
| D2 | `.claude/skills/state-bug-fix/` | Drop it entirely. A replacement, if wanted, is written from scratch later (not in this initiative). |
| D3 | `AGENTS.md` scope | Cut hard to quirks, commands and pointers into `spec/`. Consolidate on a real `CLAUDE.md` file; remove `AGENTS.md` and the symlink. |
| D4 | `spec/solver-chains/` | Delete, with the unused fixtures and `scripts/trace-recipe-chain.js` (R1). |
| D5 | `TODO.md` vs `initiatives/roadmap.md` | Merge into `initiatives/backlog.md`; drop the Shipped table (R3). |
| D6 | `spec/data-analysis.md` | Fold still-true facts into `data-model.md`, then delete (R2). |
| D7 | Code issues found by the audit | Record in the backlog only; this branch stays docs-only (plus the R1 deletions). |

## Steps

Steps 3–5 run in parallel by sub-agents with disjoint file ownership
(3+5 / 4a data-model+ui / 4b solver, corpus, overview, tech-stack, README,
deletions). They leave changes uncommitted and write
`step-3-5-notes.md`, `step-4a-notes.md`, `step-4b-notes.md`; the parent
session reviews and commits one commit per step.

- [x] **1. Audit (read-only).** Check every doc against the code. Output:
  `audit.md` — one list of findings, each tagged `outdated` / `wrong` /
  `duplicated` / `misplaced` / `broken-link`, with file:line and the
  proposed fix. Includes the D4 report on `spec/solver-chains/`.
- [x] **2. Structure decisions.** Using the audit, fix the target layout:
  final list of spec files, where the merged backlog lives, what the slim
  `CLAUDE.md` contains. Output: `structure.md`.
- [x] **3. Agent-facing docs.** Write the slim `CLAUDE.md`, remove
  `AGENTS.md` + symlink, delete the `state-bug-fix` skill, fix references to
  `AGENTS.md` elsewhere (README, spec, initiatives).
- [x] **4. Specs.** Rewrite `spec/ui.md` for the table UI; delete
  `spec/lua-export.md`; fix `overview.md`, `tech-stack.md`, and whatever the
  audit flags in `solver.md`, `data-model.md`, `data-analysis.md`,
  `test-corpus.md`, `solver-chains/`.
- [x] **5. Status reconciliation.** Merge `TODO.md` + roadmap into one
  backlog; correct Phase 6/7 status against shipped features; fix broken
  links; close the "Review project management" TODO item.
- [x] **6. Guard (optional).** Script / CI step that fails on dead relative
  links and on `src/…` / `scripts/…` paths in Markdown that do not exist.
- [~] **7. Ship.** Open PR; on merge, `git mv` this folder to
  `initiatives/archive/docs-cleanup` and update `initiatives/README.md`.

## Known findings from the initial scan

Seed list for the audit (the audit verifies and extends it):

- `AGENTS.md`: Zod 3 / Vitest 3 (actual: Zod 4.6, Vitest 5, TS 6);
  `npm test` now runs unit + e2e; `test:unit` / `test:e2e` unlisted;
  layout lists non-existent `verify-game-data.js` and omits `build-icons.mjs`
  (postbuild), `icon-compositor.js`, `scripts/__tests__/`, `src/utils/`,
  `public/data/kompetenz-seablock/`; solver described as "LU +
  pseudo-inverse"; legacy Lua mod path gone; "Phases 6–7 pending" likely
  partly false (plan export, icons, warnings popover exist); duplicates
  `spec/` content.
- `spec/ui.md` describes the old helmod sidebar/tree/recipe-card layout.
- `spec/lua-export.md` describes a removed exporter.
- `spec/tech-stack.md` references the verify script and Lua mod.
- `spec/overview.md` claims URL sharing; says Nullius-only though Seablock
  is bundled.
- `TODO.md` links `initiatives/visual-parity/tickets.md` (now in `archive/`).
- `.claude/skills/state-bug-fix/` references `TreeView.tsx`,
  `RecipeCard.tsx`, `reduce.ts`, `pin.ts`, `subplan.ts` — all gone.
