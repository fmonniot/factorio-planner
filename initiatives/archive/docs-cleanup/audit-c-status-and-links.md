# Audit C — Status reconciliation and link check

Read-only audit for step 1 of the docs-cleanup initiative (feeds steps 2, 3
and 5). Produced 2026-10-17 on branch `docs/cleanup` at `bfa5b4c`.

Status values: **done** · **partial** · **not started** · **regressed** (was
done, has since been removed) · **obsolete** (no longer meaningful as worded).

---

## Status reconciliation

### `initiatives/roadmap.md` — Phase 6 / Phase 7

| Item | Source | Actual status | Evidence |
|---|---|---|---|
| 6.1 Export plan as JSON | roadmap.md:36 | **done** | `ExportPlanButton` in `src/components/GameDataSelector.tsx:168-190`, mounted in `src/components/factory/TopBar.tsx:11`; downloads `factorio-plan-YYYY-MM-DD.json` with `{ blocks, activeBlockId }`. Covered by `e2e/plan-export.spec.ts`. Commit `5931b73` (2026-04-10). README.md:39 already says it exists. |
| 6.2 Import plan from JSON | roadmap.md:37 | **not started** (plumbing only) | No UI entry point (only file input is the game-data one, `GameDataSelector.tsx:153`). `parseAppState` in `src/data/loader.ts` validates the exported shape and is used by `src/store/persistence.ts:43`, so an importer would be thin. e2e fixtures are loaded by localStorage injection (`e2e/support/loadPlan.ts`), not through an app import. |
| 6.3 Share plan via URL | roadmap.md:38 | **not started** | No `location.hash`, `URLSearchParams`, compression or clipboard code in `src/`. `spec/overview.md` claiming URL sharing is wrong (already in seed list). |
| 6.4 Import game data JSON (custom bundle) | roadmap.md:39 | **done** | "Upload file…" option in `GameDataSelector.tsx:148`, stored in IndexedDB (`saveCustomData`/`loadCustomData`, lines 33-61) and restored on reload. Commit `be7f779` (2026-04-04, "replace game data button with persistent source selector"). Exercised by `e2e/plan-export.spec.ts` (`setInputFiles`) and `e2e/game-data-source.spec.ts`. |
| 6.5 Settings panel (default machines, rate unit, game data info) | roadmap.md:40 | **partial** | No settings panel. Rate unit sec/min toggle exists in `src/components/factory/FactorySummary.tsx:227-235`, persisted by `src/store/uiStore.ts:34-62`. No default-machine override (defaults come from `gameData.defaultMachines`), no game-data info view. |
| 7.1 Icon pipeline | roadmap.md:44 | **done** (different design) | Not a sprite sheet: per-icon PNGs extracted and layer-composited by `scripts/build-game-data.js` + `scripts/icon-compositor.js` (`2bc67f4`, `d4ad406`, `07e1cb8`, golden tests `b26ac80` in `scripts/__tests__/`); WebP + palette-PNG at `postbuild` by `scripts/build-icons.mjs` (`02173dd`); `src/utils/iconUrl.ts` (BASE_URL fix `b24aa86`); lazy `<picture>` wrapper `src/components/Icon.tsx` (`538e23d`). 2,950 icons in `public/data/nullius/icons/`, 3,416 in `public/data/kompetenz-seablock/icons/`. Wording ("recipe cards") is stale. |
| 7.2 Solver warnings in UI | roadmap.md:46 | **partial / reworded** | `src/components/factory/WarningsPopover.tsx` (+ test, `e2e/warnings-popover.spec.ts`) shows block-level warnings in the summary header (`e3ca633`, `c1f57e8`), with a one-click fix for duplicate-recipe (`648d505`). Warnings are not shown on the affected rows (`RecipeRow.tsx`/`ProductionTable.tsx` have no warning references). Listed warning types are obsolete: current types are `no-recipe`, `duplicate-recipe`, `infeasible-pins`, `overconstrained` (cycle/underdetermined went away with the LP solver). |
| 7.3 Rate-changed animation | roadmap.md:48 | **not started** | No highlight/animation code; only hover `transition-*` classes. "cards" wording stale. |
| 7.4 Responsive layout | roadmap.md:50 | **not started**; wording **obsolete** | Zero Tailwind breakpoint classes (`sm:`/`md:`/`lg:`) in `src/`. Only `max-w-[95vw]` on modals. There is no sidebar / summary bar / card list any more (table UI), so the item text needs rewriting. |
| 7.5 Keyboard navigation | roadmap.md:52 | **not started** (Escape only) | Escape closes `Modal`, `Popover`, `ItemPicker`, `WarningsPopover`; Enter/Escape in goal-rate and block-name inputs (`FactorySummary.tsx:69,192`). No arrow-key picker navigation, no shortcuts. Notably **undo/redo has no UI at all**: `undo`/`redo` exist in `src/store/blockStore.ts:161-163` but nothing in `src/components/` calls them. |

### `initiatives/roadmap.md` — Open TODOs

| Item | Source | Actual status | Evidence |
|---|---|---|---|
| Solver integration test (`src/solver/index.integration.test.ts`) against real Nullius data | roadmap.md:59-64 | **regressed** | Was implemented in `908bc74` (2026-04-04) as `src/solver/index.integration.test.ts` with `scripts/trace-recipe-chain.js` and 3 fixtures; moved to `src/solver/v1/index.integration.test.ts` and **deleted** with the v1 retirement in `f55c2db`. The four fixtures in `src/solver/__fixtures__/` are now orphaned (no test imports them; only `scripts/trace-recipe-chain.js` writes them). `spec/solver-chains/README.md:33,54` still references the deleted test (relevant to D4). Also note: the game-data file is now committed, so the `skipIf(!sampleExists)` gate would always run in CI. |

### `initiatives/roadmap.md` — Deferred (post-v1)

| Item | Source | Actual status | Evidence |
|---|---|---|---|
| Optimization mode (min machines/power) | roadmap.md:70 | not started | LP objective is Σx with BIG_M slack (see `src/solver/solve.ts`). |
| Sankey / flow diagram | :71 | not started | — |
| Mining/extraction modelling | :72 | not started | No mining/resource entities in `src/data/schema.ts` or `scripts/build-game-data.js`. Overlaps TODO "water from a pump". |
| Quality tier support | :73 | not started | Only a `quality` effect name (`schema.ts:96`) shown in effects panels; no quality tiers. |
| Multi-factory / sub-factory splitting | :74 | **partial / overlaps shipped work** | Blocks (tabs) and nested subplans ("Wrap in subfactory", `wrapNodeInSubPlan` in `blockStore.ts:700`) exist. Inter-block connections do not (= TODO "Connections between blocks"). |
| Plan diffing | :75 | not started | — |
| Recipe card grouping (manual folders / auto-group by tier) | :76 | **done** (manual) / not started (auto) | Manual grouping = subplans/subfactories + DnD (`bcab252`). Auto-group-by-tier not done. "card" wording stale. |
| Drag-and-drop goal ordering | :77 | not started | No goal-reorder action in `blockStore.ts`; DnD is recipes/subgroups only (`RecipeDnd.tsx`). |
| Dark mode | :78 | **obsolete as worded** | The UI is dark-only (`bg-gray-900` etc., no `dark:` variants, no `prefers-color-scheme`). If anything the item is "light mode / theme toggle". |
| Vanilla Factorio support | :79 | not started (no bundled dataset) | `build-game-data.js` is mod-agnostic, but no vanilla `game-data.json` is bundled. |
| Additional mod support (tested and bundled datasets) | :80 | **partial** | Seablock bundled in `public/data/kompetenz-seablock/` and listed in `GameDataSelector.tsx:11` (`de0c2ab`, 2026-10-17). Side note: that entry's id is `'kompetenz-seablock/'` and the URL has `//game-data.json` — harmless today but looks like a typo. |
| In-app Lua script runner | :81 | **obsolete** | D1: Lua exporter is gone; drop. |
| Named plan links (server-side short URLs) | :82 | not started | Depends on 6.3; conflicts with "no backend" principle. |
| Read-only plan view | :83 | not started | Depends on 6.3. |

### `initiatives/roadmap.md` — Shipped table inaccuracies

| Row | Source | Problem |
|---|---|---|
| Phase 0 — "Lua export" | roadmap.md:14 | Historical but now misleading (D1). Data comes from `factorio --dump-data` + `scripts/build-game-data.js` since `1b39238`. |
| Phase 1 — "(29 unit tests)" | :15 | Stale count; harmless but meaningless today. |
| Phase 3 — "Plan store with undo/redo" | :17 | Store has undo/redo but it is not reachable from the UI (see 7.5). |
| Missing row: Flatten subplans | — | `initiatives/README.md` lists it as shipped (`archive/flatten-subplans/`, `fb79152`) but the roadmap Shipped table omits it. |
| Missing rows: features shipped outside initiatives | — | Plan JSON export (`5931b73`), custom game-data upload (`be7f779`), icon pipeline (`d4ad406`, `02173dd`, `538e23d`), warnings popover + duplicate fix (`e3ca633`, `648d505`), GitHub Pages deploy (`3c894a6`), Seablock dataset (`de0c2ab`), locale-correct names (`c85dfe4`), byproduct-consumer mode (`d10881c`), per-node primary product override (`0ecacda`), no-import items. |
| Edit Beacon modal — "Game-data exporter updated" | :24 | Correct only if read as `build-game-data.js` (`50b8821`); fine. |
| Whole table | — | Duplicates `initiatives/README.md` index; this is how it drifted. See proposal below. |

### `TODO.md`

| Item | Source | Actual status | Evidence |
|---|---|---|---|
| Module & machine labels (human-readable names) | TODO.md:10 | **done** | Selectors render `m.name` (`MachinePopover.tsx:68`, `ModulePopover.tsx:104,138`, `EditMachineModal.tsx:236`). `build-game-data.js` builds a locale map (`buildLocaleMap`, line ~227); fixed in `c85dfe4`. In Nullius data, no modules and only 3/136 machines (`nullius-turbine-vent-1..3`, exporter quirk) have `name === id`. |
| Beacon: multiple beacon types per machine | TODO.md:13 | not started | `RecipeNode.beaconConfig` is a single optional `BeaconConfigSchema` (`schema.ts:165-179`). |
| Beacon: enforce module restrictions | TODO.md:14 | not started | `BeaconModal.tsx:73-74` lists all non-hidden modules; no beacon `allowedEffects` filter. |
| Rename sub-blocks | TODO.md:16 | **partial** (store only) | `renameSubPlan` exists in `blockStore.ts:135,320` but no component calls it. |
| Bug: game selector doesn't switch state | TODO.md:20 | not started | Single key `factorio-planner:app-state` (`persistence.ts:9`), not per modset. |
| Bug: can't make water from a pump | TODO.md:22 | not started | No offshore-pump/resource handling in `build-game-data.js`. Nullius models seawater via `nullius-seawater-intake-*` recipes, so this is mostly a Seablock/vanilla problem — worth noting in the item. |
| Connections between blocks | TODO.md:26 | not started | — |
| Plan horizon (tech filtering) | TODO.md:28 | not started | No technology data in schema or exporter. |
| Usage README | TODO.md:32 | **done** | `6c2f08d`. Already ticked. |
| Review project management | TODO.md:34 | in progress | This initiative; close in step 5. |
| Header text | TODO.md:4-6 | wrong | Links `initiatives/visual-parity/tickets.md` (now `archive/`), and "the UI redesign tracked here" is obsolete. |

---

## Proposed merged backlog

### Location

Recommendation: **`initiatives/backlog.md`**, created with
`git mv initiatives/roadmap.md initiatives/backlog.md` (keeps history), then
fold `TODO.md` into it and `git rm TODO.md`.

Why there and not a root `BACKLOG.md`:

- It is time-bound content, which the layout rules put under `initiatives/`.
- One fewer root file; README's "Project layout" table and the slim `CLAUDE.md`
  point to it once.
- "Roadmap" over-promises sequencing (Phase 6 → 7) that has not held; most
  items are independent. "Backlog" matches how it is actually used.

Drop the **Shipped** table. It duplicates the `initiatives/README.md` index
and the git log, and it is the part that drifted. Replace it with one line
pointing to `initiatives/README.md` (archive index) and `git log`. If a
history of pre-initiative phases (0–5) is wanted, add a single "Before
initiatives existed" row to `initiatives/README.md` instead.

Files to update after the merge: `README.md:39,93,99`;
`initiatives/README.md:3,20,31`; the new `CLAUDE.md` (replaces
`AGENTS.md:41-42,165,171,215`); the `docs-cleanup/plan.md` D5 row.
`initiatives/archive/reorder-recipes-dnd/plan.md:15` links `../../TODO.md` —
archive, leave.

### Draft content

```markdown
# Backlog

Single list of planned and possible work. When an item grows a design doc,
promote it to its own folder under `initiatives/` and link it here. Shipped
initiatives are indexed in [README.md](README.md); smaller shipped items are
in `git log`.

Markers: `[ ]` not started · `[~]` partly done (say what is missing)

## Bugs

- [ ] **Switching game data keeps the old plan.** Selecting another data set in
  the top-right selector keeps the current plan, so the new set shows "unknown
  recipe" errors. Each modset should keep its own plan state (one storage key
  per modset), which would also let several modsets coexist.
- [ ] **Water from an offshore pump.** Offshore pumps (and other fluid sources
  that are entities, not recipes) cannot produce water in a plan. Nullius is
  unaffected (seawater intakes are recipes); Seablock and vanilla are.

## Sharing and import

- [ ] **Import plan from JSON.** Counterpart of the existing "Export plan"
  button; reuse `parseAppState` for validation.
- [ ] **Share plan via URL.** Compressed base64 in the URL, with a size warning.
- [ ] **Read-only shared view.** Depends on URL sharing.

## Planning features

- [ ] **Connections between blocks.** One block's output feeding another
  block's input.
- [ ] **Plan horizon.** Limit available recipes by technology so the player
  decides how far ahead they plan. Needs technology data in the export.
- [ ] **Mining and extraction.** Model miners, pumps and other resource
  entities (covers the offshore-pump bug properly).
- [ ] **Optimization mode.** Minimize machines or power through the LP
  objective.
- [ ] **Quality tiers.**

## UI / UX

- [ ] **Undo/redo in the UI.** The store supports it; there is no button or
  shortcut.
- [ ] **Keyboard navigation.** Arrow keys and Enter in the pickers; shortcuts
  for add goal, undo, redo.
- [ ] **Rename sub-blocks (subfactories).** `renameSubPlan` exists in the
  store; no UI.
- [~] **Solver warnings on rows.** Warnings show in the summary-header popover;
  they are not yet marked on the affected recipe rows.
- [~] **Settings.** Rate unit (sec/min) toggle exists. Missing: default machine
  per category, game-data info (modset, version, counts).
- [ ] **Beacons: several beacon types per recipe.**
- [ ] **Beacons: enforce module restrictions** (e.g. no productivity in
  Nullius beacons — verify in game first).
- [ ] **Rate-changed highlight.** Briefly highlight rows whose rate changed
  after a solve.
- [ ] **Responsive layout.** Usable production table on narrow screens.
- [ ] **Drag-and-drop goal ordering.**
- [ ] **Auto-group recipes by tier.** (Manual grouping exists via subfactories.)

## Data sets

- [~] **More bundled data sets.** Nullius and Seablock are bundled. Candidates:
  vanilla Factorio 2.0.

## Tests and tooling

- [ ] **Solver integration test on real data.** Restore a
  `src/solver/index.integration.test.ts` that runs the fixtures in
  `src/solver/__fixtures__/` (currently orphaned since `f55c2db`) against
  `public/data/nullius/game-data.json`.

## Ideas (not planned)

- Sankey / flow diagram view
- Plan diffing
- Light theme / theme toggle
- Named plan links (needs a server; conflicts with "no backend")
```

Removed from the old lists, with reason:

| Item | Reason |
|---|---|
| 6.1 Export plan JSON | done (`5931b73`) |
| 6.4 Import game data JSON | done (`be7f779`) |
| 7.1 Icon pipeline | done (`d4ad406`, `02173dd`, `538e23d`) |
| Module & machine labels | done (`c85dfe4`) |
| Usage README | done (`6c2f08d`) |
| Review project management | closed by this initiative |
| In-app Lua script runner | obsolete (D1) |
| Dark mode | UI is already dark-only; reworded as "light theme" idea |
| Recipe card grouping (manual) | done via subfactories + DnD |
| Multi-factory / sub-factory splitting | blocks + subfactories shipped; remainder is "Connections between blocks" |
| Additional mod support | reworded as "More bundled data sets" |

---

## Broken links and paths

Method: every Markdown link target and every inline-code / fenced path
starting with `src/`, `scripts/`, `e2e/`, `public/`, `spec/`, `initiatives/`
in `git ls-files '*.md'` (30 files; `CLAUDE.md` is a symlink to `AGENTS.md`
and counted once), resolved relative to the file and to the repo root. Plus a
pass for bare file names (`Foo.tsx`, `bar.ts`) that match no tracked file.

### Live docs (fix)

| File:line | Reference | Problem |
|---|---|---|
| TODO.md:6 | `[…](initiatives/visual-parity/tickets.md)` | Moved to `initiatives/archive/visual-parity/tickets.md`. Moot after the merge. |
| AGENTS.md:43 | `verify-game-data.js` (layout) | Script does not exist. |
| AGENTS.md:144-145 | `scripts/verify-game-data.js`, `public/data/nullius/game-data.json.backup` | Neither exists. |
| AGENTS.md:149 | `scripts/factorio-planner-export_1.0.0/` | Lua mod removed (D1). |
| spec/tech-stack.md:68 | `scripts/verify-game-data.js` | Does not exist. |
| spec/tech-stack.md:70 | `scripts/factorio-planner-export_1.0.0/` | Removed (D1). |
| initiatives/roadmap.md:59 | `src/solver/index.integration.test.ts` | Deleted in `f55c2db` (see Open TODOs). Fine in a backlog item that asks to recreate it. |
| spec/solver-chains/README.md:33, 54 | `src/solver/index.integration.test.ts` | Deleted; the README's workflow is broken (D4). |
| spec/solver-chains/README.md:49-52 | `my-item.md`, `my-item.fixture.json` | Placeholders in an example — not broken. |
| .claude/skills/state-bug-fix/SKILL.md:27-29 | `src/components/TreeView.tsx`, `src/solver/reduce.ts` | Gone. Whole skill is deleted under D2. |
| .claude/skills/state-bug-fix/references/project-architecture.md:15-21, 99, 135-136 | `reduce.ts`, `pin.ts`, `subplan.ts`, `TreeView.tsx`, `RecipeCard.tsx` | Gone. Deleted under D2. |
| initiatives/docs-cleanup/plan.md:58, 77 | `initiatives/archive/docs-cleanup`, `initiatives/visual-parity/tickets.md` | Intentional (future path / quoting a finding). Not broken. |

No broken relative links found in `README.md`, `initiatives/README.md`,
`spec/*.md` (other than the above). Content-level staleness in `spec/ui.md`
etc. is covered by the other audits.

### Archive (leave)

All in `initiatives/archive/`; frozen, report only. Two systemic causes:
links written as `../../…` when the file lived at `initiatives/<name>/` now
resolve to `initiatives/…` after `git mv` into `archive/`; and
`flatten-subplans/plan.md` uses repo-root-relative links, which never
resolved.

| File | Lines | Reference(s) | Cause |
|---|---|---|---|
| archive/edit-machine-modal/design.md | 8, 10, 11, 13 | `../../src/components/factory/{RecipeRow,MachinePopover,ModulePopover}.tsx` | `../../` depth after move |
| archive/reorder-recipes-dnd/plan.md | 9, 15, 36, 61, 79, 88, 97, 113-118, 124-128 | `../../src/…`, `../../TODO.md`, `../../e2e/…` | `../../` depth after move |
| archive/reorder-recipes-dnd/plan.md | 97, 118, 144 | `e2e/recipe-drag-and-drop.spec.ts` | Planned spec never created under that name |
| archive/ui-redesign/plan.md | 433, 441, 483-495 | `../../scripts/…`, `../../src/…`, `../../e2e/…` | `../../` depth after move |
| archive/ui-redesign/plan.md | 88, 93, 218, 231, 241, 396, 397 | `src/App.tsx`, `AppShell.tsx`, `FloorBreadcrumb.tsx`, `BalancedItemsFooter.tsx`, `SubfactorySidebar.tsx` | Files removed/never created |
| archive/visual-parity/tickets.md | 7, 86 | `../archive/ui-redesign/plan.md` | Resolves to `archive/archive/…` |
| archive/visual-parity/tickets.md | 113, 256 | `src/components/factory/RecipeRow.tsx#L…`, `BalancedItemsFooter.tsx` | Root-relative link; file removed |
| archive/flatten-subplans/plan.md | 11, 15, 46, 54, 66, 71, 74, 76, 82, 96-99, 107-110, 116, 136-151 | ~35 links to `src/…`, `e2e/…`, `spec/…`, `AGENTS.md`, `initiatives/archive/lp-solver/…json` | Root-relative links; also `subplan.ts`, `subplan.test.ts`, `BalancedItemsFooter.tsx`, `e2e/subplan-empty-state.spec.ts` deleted |
| archive/lp-solver/seed.md | 73, 122, 219, 234, 237, 247, 261, 283-293 | `src/solver/{reduce.ts,v1/,v2/,__harness__/…}`, `__fixtures__/nullius-ethylene-methane.json`, `e2e/solver-version-toggle.spec.ts` | Removed by v1 retirement / flatten (`f55c2db`, `0671bf7`) |
| archive/lp-solver/tasks.md | 40-46, 67, 85, 92, 110-162, 270, 302 | same family (`v1/`, `v2/`, `__harness__`, `v2/warnings.ts`, `solver-version-toggle.spec.ts`) | same |

If the step-6 guard is built, it should skip `initiatives/archive/`.

---

## AGENTS.md references

All tracked occurrences (`git grep AGENTS`), excluding `AGENTS.md` itself
(lines 1, 194, 206, 212, 213 — the file goes away under D3):

| File:line | Text | Action |
|---|---|---|
| CLAUDE.md | symlink → `AGENTS.md` | Replace with a real file (D3). |
| spec/data-analysis.md:4 | "see AGENTS.md for how to regenerate" | Point to `README.md#exporting-game-data` (README:64 has the procedure) or the new `CLAUDE.md`. |
| spec/test-corpus.md:4 | "see AGENTS.md for how to regenerate" | Same. |
| TODO.md:34 | "Review project management … `AGENTS.md`" | Item closes in step 5; file disappears with D5. |
| initiatives/docs-cleanup/plan.md:32, 46, 47, 64 | Decision/step text | Intentional. |
| initiatives/archive/flatten-subplans/plan.md:145 | `[AGENTS.md](AGENTS.md)` | Archive (leave). |

No references in `README.md`, `.github/`, `.claude/`, `package.json` or source.
Implicit ones: `AGENTS.md:206,212-213` ("update the layout table in this
file") — the slim `CLAUDE.md` must not carry this rule forward verbatim,
since it would then point at itself.

---

## .github notes

Files: `.github/dependabot.yml`, `.github/workflows/test.yml`,
`.github/workflows/deploy.yml`. None of them is mentioned by any doc.

- **test.yml** runs on `pull_request`, on `v*` tags, and as a reusable
  workflow: `npm ci` → `lint` → `test:unit` → Playwright chromium install →
  `test:e2e` → `build`. It does **not** run on pushes to `main`. Worth one line
  in `CLAUDE.md` ("CI runs lint, unit, e2e, build on every PR") so agents know
  what must pass.
- **deploy.yml** deploys `dist/` to GitHub Pages on a published **release**
  (or manual dispatch), gated by `test.yml` (`3c894a6`). `vite.config.ts:10`
  sets `base: '/factorio-planner/'` in production, which is why `iconUrl`
  prefixes `BASE_URL` (`b24aa86`). README links the live site (README.md:7)
  but no doc says how a release is cut. Suggest a short "Releasing" note
  (README or `CLAUDE.md`): publish a GitHub release → tests → Pages deploy.
  `npm run build` also runs `postbuild` (`scripts/build-icons.mjs`), which
  needs `sharp` — relevant to `spec/tech-stack.md`.
- **Node version**: both workflows pin Node 22; no doc states a Node
  requirement. `spec/tech-stack.md` could mention it.
- **dependabot.yml**: weekly npm updates, max 10 open PRs, grouped `react`
  and `vitest` (`8add882`). Explains why version pins in docs drift (Zod
  3 → 4.6, Vitest 3 → 5, TS 6). Supports the D3 direction of *not* restating
  exact versions in `CLAUDE.md`/`tech-stack.md`; say "see `package.json`"
  instead. Leftover template comments at the top of the file are harmless.
- **AGENTS.md "Integration tests skip when game-data.json is absent"**: the
  file is committed (`public/data/nullius/game-data.json`), so in CI and in
  every checkout `loader.integration.test.ts` always runs. The "run locally
  after re-exporting" advice is outdated.
- Step 6 (link guard) would fit as an extra step in `test.yml` before
  `test:unit`, e.g. `node scripts/check-doc-links.mjs`, skipping
  `initiatives/archive/`.
