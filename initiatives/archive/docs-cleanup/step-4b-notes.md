# Step 4b notes — solver/corpus/overview/tech-stack/README + R1 deletions

Part of step 4, run in parallel with other agents (data-model, ui, data-analysis,
backlog). Nothing committed; deletions are staged with `git rm`, edits are
unstaged.

## Changes

### Deletions (D1, R1/D4)

- `git rm spec/lua-export.md`
- `git rm -r spec/solver-chains/` (README + 3 chain docs)
- `git rm -r src/solver/__fixtures__/` (4 fixture JSON files)
- `git rm scripts/trace-recipe-chain.js`

Pre-deletion grep (excluding `node_modules`, `dist`, `.git`, `initiatives/archive`):
the only references were inside the deleted files themselves and in
`initiatives/archive/docs-cleanup/` (intentional history). Nothing in `package.json`,
`vitest.config.ts`, `playwright.config.ts`, tests or e2e imports the fixtures or
the trace script.

### Comment-only code edits

- `src/data/schema.ts`: `luaArray` docstring now attributes `{}`-for-empty-table to
  Factorio's serialisation (helper name unchanged — renaming is code);
  `mainProduct` comment now names `build-game-data.js` as the emitter of `""`;
  `craftingSpeed` default comment no longer mentions the Lua script.
- `scripts/build-game-data.js`: header no longer says "Replaces the runtime Lua
  mod"; `parseEnergyKw` and `resolveMainProduct` comments reworded without Lua.

### spec/solver.md

Rewritten in place, keeping the structure. Verified against `src/solver/*.ts`
and `src/store/solverStore.ts`:

- New "Pipeline" section (order of steps in `solve()`); one LP variable per
  distinct `recipeId`, so duplicate nodes share throughput.
- Intermediates `≥ 0` allows surplus (reported as `overconstrained`).
- Slack only for intermediates not in `noImportItems`; goals never have slack;
  goals with no row in `S` get no LP constraint.
- Objective written with `c_j` (BC_BONUS vs 1); tolerances listed
  (`SLACK_TOLERANCE`, `SURPLUS_TOLERANCE` 1e-6, `GOAL_SHORTFALL_TOLERANCE` 1e-4).
- New "Infeasibility" section: `infeasible-pins` only when pins exist; without
  pins, no warning, only goal shortfalls; throughput clamping; pins forced only
  when feasible.
- Warnings: `duplicate-recipe`, `no-recipe`, `infeasible-pins`, `overconstrained`
  (removed the nonexistent `too-many-alternatives`); output ordering of
  warnings and `unsatisfied`; raw consumption skips goal-shortfall items.
- `discard` applied after classification (item keeps its class; `outputRates`
  still include it); `feed-back` is a solver no-op; `primaryProduct` is
  display-only; `noImportItems` is per block and only matters for intermediates.
- `flattenBlock` collects subplan handles too; `solve()` filters `game-recipe`.
- Machine resolution (`machineId ?? defaultMachines[category]`, 0 if none);
  additive effects formula incl. beacon multiplier; solver ignores
  `allowProductivity`; power = `machineCountExact · (energyUsageKw · (1 +
  consumptionBonus) + drainKw)`, no beacon power.
- Store: 150 ms debounce; `idle` without game data; empty `solved` result with
  no active block / zero goals / zero nodes; `error` on exceptions; `lastResult`
  persists across re-solves.

### spec/test-corpus.md

- Recipe ids `nullius-iron-{ingot,plate,rod}-1` → without `-1` (verified in the
  committed export: same stoichiometry and times).
- Header: points to the committed export and README "Exporting game data"
  (no AGENTS.md); states the cases are not currently automated as tests; notes
  that real default machines differ, so override `machineId` with a speed-1
  machine; notes that cases 4–6 use hidden base-game recipes, kept on purpose.
- Gravel / air-separation extra outputs: "classified as byproduct, excluded from
  LP rows" instead of feed-back wording.
- Cases 4 and 6: U-238 reported as "External import" via intermediate slack
  (U-238 is an intermediate), not raw consumption.

### spec/overview.md

Removed URL-sharing claim and helmod/tree wording; Nullius primary + Seablock
bundled (best-effort) + uploadable data; nothing loaded until a dataset is
picked (remembered); localStorage plans, IndexedDB custom data, JSON export;
dropped "v1" framing and the "any mod other than Nullius" non-goal.

### spec/tech-stack.md

Versions by pointer to `package.json` (Dependabot); dropped recipe-card /
helmod wording; undo/redo store-level only, not exposed in UI; added a Zod
section; Vite base path + dev WebP middleware + `postbuild` icons; testing
section with the three Vitest projects (`dom`, `node`, `scripts`) and no
corpus-coverage claim; data pipeline without verify script / Lua mod, with
`icon-compositor.js`, `sharp`, `adm-zip`, `public/data/<dataset>/`; bundled data
instead of "no bundled data"; hosting = GitHub Pages; removed the Project
Structure tree (README owns the map); new "CI and deployment" section
(test.yml on PRs / `v*` tags / reusable, deploy.yml on release, Node 22,
Dependabot).

### README.md

- Game data: nothing loaded on first visit, pick Nullius or Seablock; choice
  remembered.
- Goals: "+" in the Products pane (tooltip "Add goal").
- No per-row recipe swap: "+ Add recipe", replace = add + remove.
- Byproducts: click a byproduct of a multi-output recipe to make it primary;
  dropped the unreachable policy toggle; bc toggle kept.
- Lock: click in Ingredients pane, chip to unlock.
- Warnings: real warning kinds; indicator in the summary header next to the
  rate toggle.
- Blocks: click tab to switch; rename via summary header or tab right-click
  (Rename / Delete).
- Links to `initiatives/roadmap.md` and `TODO.md` → `initiatives/backlog.md`.
- Node 22 stated as the CI version; command list adds `test:watch`, `test:e2e`,
  `preview`, `postbuild`; "React 19" → "React" (no drifting version).
- Both datasets committed; repository map rewritten as the canonical layout
  (`src/main.tsx`, solver files, `src/utils/`, each script, `scripts/__tests__/`,
  `public/data/` with both datasets, `e2e/`, `spec/`, `initiatives/`,
  `.github/workflows/`, `CLAUDE.md`; no `TODO.md`).

## Test results

- `npx vitest run src/solver src/data` — 5 files, 71 tests passed.
- `node --check scripts/build-game-data.js` — OK.
- `npx tsc -b --noEmit` — no errors.

## References outside my ownership

- `src/data/loader.test.ts:205-206` — test name and comment still say "Lua export
  sentinel" / "The Lua exporter emits \"\"". Suggest: "build-game-data.js emits
  \"\" …" (comment-only).
- `spec/data-analysis.md:14,20,122` — Lua mentions; file is being folded into
  data-model.md and deleted by another agent.
- `initiatives/archive/docs-cleanup/*` mention deleted paths as history — intentional.
- Code comments flagged by audit B, not in my ownership: `src/solver/solve.ts:40,42,45`
  (`solveLP` docstring says goals have slack, omits BC_BONUS);
  `src/solver/effects.ts:17` (`buildStoichiometryMatrix` → `buildClassifiedSystem`);
  `src/solver/build.ts:31` ("probability only"); `src/solver/index.ts:14`
  (`flattenBlock` docstring says it skips subplan handles; it doesn't).

## Open questions

- README "Lock an item": locking a **raw** item has no effect on the solver (raw
  items have no LP row). The README wording ("never imports it") is accurate only
  for intermediates. Left as is; could be worth a backlog note or a UI hint.
- Duplicate-recipe nodes share one LP variable, and their effects / pins are
  taken from the last node with that recipe id (Map overwrite). Documented only as
  "share one throughput"; the last-wins behaviour may be worth a backlog item.
- `GameDataSelector.tsx:11` Seablock URL has `//` (already a backlog item per
  audit).
