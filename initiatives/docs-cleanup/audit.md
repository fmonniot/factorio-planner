# Audit — index and summary

Output of step 1. Detailed findings (file:line, evidence, proposed fix) live
in three appendices; this file is the summary and the work queue.

| Appendix | Covers |
|---|---|
| [audit-a-agent-and-specs.md](audit-a-agent-and-specs.md) | AGENTS.md (incl. duplication-vs-pointer table for D3), README.md, spec/overview, tech-stack, ui, data-model, lua-export; "UI as it is today" sketch |
| [audit-b-solver.md](audit-b-solver.md) | spec/solver.md, test-corpus.md, data-analysis.md, solver-chains/ (D4 recommendation) |
| [audit-c-status-and-links.md](audit-c-status-and-links.md) | Roadmap + TODO status vs code, **draft merged backlog**, broken links/paths, AGENTS.md references, .github notes |

## Headline findings

1. **Corpus tests do not exist.** The 6 cases in `spec/test-corpus.md` were
   deleted with the v1 solver (`f55c2db`) and never ported. AGENTS.md and
   tech-stack.md claim they are covered. Expected values still match today's
   `solve()` output (verified with a throwaway probe). → backlog item; docs
   must stop claiming coverage.
2. **AGENTS.md** is wrong on versions (Zod 4.6, Vitest 5, TS 6), commands
   (`npm test` = unit + e2e; `test:unit`, `test:e2e`, `postbuild` icons),
   layout (`verify-game-data.js`, Lua mod gone; `build-icons.mjs`,
   `icon-compositor.js`, `src/utils/`, Seablock data missing), solver
   ("LU + pseudo-inverse"; nonexistent `too-many-alternatives` warning),
   `mainProduct` (`z.preprocess`, emitted by `build-game-data.js`), and
   "integration tests skip" (data is committed, they always run).
3. **spec/ui.md** is entirely obsolete (helmod sidebar/tree/cards). Rewrite
   from the sketch in appendix A.
4. **spec/data-model.md** is badly out of date: `Plan` → `AppState` →
   `Block` → `SubPlan`, node `kind` union, many missing fields, wrong
   warning types.
5. **spec/solver.md**: structure right, ~12 detail errors (power formula,
   goals have no slack, warning list, per-block `noImportItems`, discard
   timing, undocumented tolerances / machine selection / store skip rules).
6. **spec/overview.md, tech-stack.md**: URL sharing claimed, "Nullius only",
   "no bundled data", Cloudflare/Vercel (actual: GitHub Pages on release).
7. **README.md**: Nullius not loaded by default; warnings live in the
   summary header; no per-row recipe swap; byproduct policy toggle not
   reachable; rename via summary header / tab right-click.
8. **Roadmap/TODO status**: done — 6.1, 6.4, 7.1, module/machine labels;
   partial — 6.5 (rate unit only), 7.2 (popover, not per-row), sub-block
   rename (store only); undo/redo exists in store but no UI. Roadmap's
   "solver integration test" was built then deleted.
9. **Broken links**: TODO.md → visual-parity; verify script / Lua mod refs;
   solver-chains README → deleted test; `state-bug-fix` skill → removed
   files. ~80 broken links in `initiatives/archive/` — leave (frozen).
10. **AGENTS.md inbound refs**: `spec/data-analysis.md:4`,
    `spec/test-corpus.md:4`, `TODO.md:34`.

## Recommendations needing a decision (step 2)

- **R1 (D4):** delete `spec/solver-chains/`, the 4 unused
  `src/solver/__fixtures__/*.fixture.json`, and `scripts/trace-recipe-chain.js`.
- **R2:** delete `spec/data-analysis.md` after folding its still-true facts
  into `spec/data-model.md`.
- **R3 (D5):** `git mv initiatives/roadmap.md initiatives/backlog.md`, fold
  in `TODO.md`, delete `TODO.md`, drop the "Shipped" table (duplicates
  `initiatives/README.md`). Draft in appendix C.
- **R4:** document CI/deploy (CI on PRs + `v*` tags; Pages deploy on
  release; Node 22) — in tech-stack.md, with Node version in README.

## Code issues spotted (not docs — go to the backlog, not fixed here)

- Restore the 6 corpus cases as solver unit tests.
- `GameDataSelector.tsx:11`: Seablock id `'kompetenz-seablock/'` → URL has `//`.
- `MachinePopover` and `ModulePopover` are never rendered (dead code?).
- `gameDataVersion` is never set.
- Undo/redo and `renameSubPlan` exist in the store with no UI.
- CI does not run on pushes to `main`.
