# Target structure

Output of step 2. Decisions R1–R4 confirmed by the user on 2026-10-17
(see [audit.md](audit.md) for the recommendations). This file is the
blueprint for steps 3–5.

## Final file layout

```
README.md                 user-facing: usage, dev setup, export recipe (canonical), repo map (canonical)
CLAUDE.md                 real file (not a symlink); slim agent conventions — see below
spec/
  overview.md             fix: no URL-sharing claim, bundled Nullius + Seablock, GitHub Pages
  tech-stack.md           fix: versions by pointer to package.json, CI/deploy section (R4), drop verify/Lua refs, drop project-structure duplicate
  solver.md               fix: ~12 detail errors (appendix B)
  data-model.md           rewrite: AppState → Block → SubPlan, node kind union, missing fields, warnings; absorbs data-analysis facts (R2) and the mainProduct rule
  test-corpus.md          fix: recipe ids, U-238 reporting, feed-back wording, hidden-recipe note; state plainly that cases are not yet automated
  ui.md                   rewrite from appendix A "UI as it is today"
initiatives/
  README.md               index; remove Roadmap row, add Backlog row; one "Before initiatives existed" row for phases 0–5
  backlog.md              git mv from roadmap.md; folds in TODO.md (draft in appendix C) + code issues from audit.md
  docs-cleanup/           this initiative
  archive/                untouched (broken links there are left as-is)
```

## Deletions

| Path | Reason |
|---|---|
| `AGENTS.md` (+ `CLAUDE.md` symlink → replaced by a real file) | D3 |
| `.claude/skills/state-bug-fix/` | D2 |
| `spec/lua-export.md` | D1 |
| `spec/solver-chains/` | R1 / D4 |
| `src/solver/__fixtures__/*.fixture.json` (4 files) | R1 — unused since `f55c2db` |
| `scripts/trace-recipe-chain.js` | R1 |
| `spec/data-analysis.md` | R2 — facts folded into data-model.md first |
| `TODO.md` | R3 — folded into `initiatives/backlog.md` |

Also strip Lua-exporter mentions from code comments (`schema.ts`,
`build-game-data.js`) — comment-only edits.

## Slim `CLAUDE.md` contents

Keep (rules and quirks — things not derivable from spec or code):

1. One-paragraph "what this is" + pointer to README / spec/overview.md.
2. Quirks: separate `vite.config.ts` / `vitest.config.ts`; Tailwind v4
   `@import "tailwindcss"`.
3. Commands, corrected: `dev`, `build` (incl. postbuild icons), `preview`,
   `lint`, `test` (unit + e2e), `test:unit`, `test:watch`, `test:e2e`;
   `npx playwright install chromium` on fresh checkout.
4. Type-system rules: `schema.ts` is the source of truth, `z.output`, import
   from `types.ts`, no casts.
5. Test rules: fixture factories return `structuredClone`; Vitest
   `expect(v, msg)`; prefer Playwright e2e over manual validation;
   `spec/test-corpus.md` is ground truth (not yet automated — see backlog).
6. Spec documents table (pointers), regenerated for the final layout.
7. Documentation layout rules (spec timeless / initiatives time-bound,
   status badge, archive by `git mv`, README index) — updated for
   `backlog.md` replacing `roadmap.md` + `TODO.md`.
8. Spec maintenance table, updated (CLAUDE.md, backlog.md; layout changes →
   README repo map).

Drop (duplicated or status): tech-stack sentence, repository layout (README
owns it), mainProduct transform (→ data-model.md), solver pipeline /
classifications / productivity / Kovarex / byproduct consumers (→
solver.md), game data export (→ README), "not yet implemented" (→ backlog).

## Inbound reference fixes

- `spec/data-analysis.md:4` — file deleted.
- `spec/test-corpus.md:4` — "see AGENTS.md" → README "Exporting game data".
- `README.md:39,93,99` — roadmap/TODO links → `initiatives/backlog.md`.
- `initiatives/README.md:3,20,31` — roadmap → backlog.
- `docs-cleanup/plan.md` — mentions of AGENTS.md are intentional history.

## Step ordering

- Step 3: CLAUDE.md, delete AGENTS.md/symlink/skill. Write the spec table
  for the *final* layout (no data-analysis, lua-export, solver-chains).
- Step 4: specs — deletions first (lua-export, solver-chains + fixtures +
  trace script), then data-model (absorbing data-analysis, then delete it),
  ui, solver, test-corpus, overview, tech-stack, README fixes.
- Step 5: backlog merge, initiatives/README, close the "Review project
  management" item.
