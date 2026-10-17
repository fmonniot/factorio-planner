# Audit B — solver docs

Read-only audit of `spec/solver.md`, `spec/test-corpus.md`, `spec/data-analysis.md`
and `spec/solver-chains/` against `src/solver/`, `src/store/solverStore.ts`,
`src/data/schema.ts`, `src/data/types.ts` (branch `docs/cleanup`, 2026-10-17).

How it was checked:

- `npx vitest run src/solver` passes: 3 files, 37 tests.
- I ran the 6 corpus cases and the 4 `__fixtures__` through today's `solve()` against
  `public/data/nullius/game-data.json`, using a throwaway Vitest probe in the session
  scratchpad. Nothing was added to the repo.
- The local `~/Library/Application Support/factorio/script-output/data-raw-dump.json`
  is a **Seablock** dump: it has angels recipes and no `nullius-*` recipes. So the raw-dump
  counts in `data-analysis.md` could only be checked against the exported
  `game-data.json`, not against a Nullius raw dump.

---

## spec/solver.md

- [wrong] spec/solver.md:23 — The doc says an intermediate "must net to ≥ 0 (no surplus, no deficit)". `≥ 0` does allow surplus, and the code detects surplus after the solve and reports it as `overconstrained`. — src/solver/solve.ts:121-124 (`addConstraintWithSlack(itemId, 0)` → `{ min: 0 }`); src/solver/index.ts:130-141 — Fix: "must net to ≥ 0 (no deficit; surplus is allowed and reported as `overconstrained`)".
- [wrong] spec/solver.md:37 — The doc says `s_i ≥ 0` exists "for each goal/intermediate". In the code, goals have no slack. Intermediates listed in `noImportItems` have no slack either. — src/solver/solve.ts:108-119 (goal rows, no slack), :99-101 (no-import early return) — Fix: "for each intermediate not in `noImportItems`".
- [outdated] spec/solver.md:53-56 — The objective and constants are correct (`BIG_M = 1e6`, `BC_BONUS = -0.01`). But the tolerances the solver uses are not documented. — src/solver/solve.ts:24-32 (`SLACK_TOLERANCE = 1e-6`); src/solver/index.ts:131 (`SURPLUS_TOLERANCE = 1e-6`), :196 (`GOAL_SHORTFALL_TOLERANCE = 1e-4`) — Fix: add one line listing the three tolerances.
- [wrong] spec/solver.md:62 — The doc says "three diagnostic passes" but lists seven bullets. It also says the LP "always returns a feasible solution as long as goals have producers and pins don't conflict". In fact `noImportItems` rows can also make the LP infeasible, and that case raises **no** warning: the only infeasibility warning is gated on pins being present. — src/solver/solve.ts:99-101, :146-148 — Fix: drop the count. State that infeasibility without pins is visible only through goal shortfalls.
- [wrong] spec/solver.md:68 — The `too-many-alternatives` warning does not exist. It is not in the `SolverWarning` union, nothing in `src/` emits it, and the UI has no case for it. — src/data/types.ts:49-53; src/components/factory/WarningsPopover.tsx:13-16; an empty leftover header at src/solver/solve.test.ts:306-308 — Fix: delete the bullet. Optionally also delete the empty test-section header.
- [outdated] spec/solver.md:60-72 — The `no-recipe` warning is undocumented. It fires when a goal item has no positive coefficient in `S`, and it is emitted before the LP. — src/solver/index.ts:73-81; src/data/types.ts:50; test at src/solver/index.test.ts:103-121 — Fix: add a bullet.
- [outdated] spec/solver.md:60-72 — The order of results is undocumented. Warnings come out as `duplicate-recipe` → `no-recipe` → LP warnings (`infeasible-pins`, `overconstrained`). `unsatisfied` comes out as goal shortfalls → intermediate slack → raw consumption. Raw consumption skips any item already reported as a goal shortfall. — src/solver/index.ts:217-219, :233-236 — Fix: add one sentence on ordering and on the de-duplication.
- [wrong] spec/solver.md:81 — The doc says `byproductPolicy = 'discard'` zeroes the coefficient "before classification". The code zeroes it **after** `buildClassifiedSystem`, so the item keeps the classification it had before the zeroing. `SolvedNode.outputRates` also still includes the discarded product. — src/solver/index.ts:71 (classify) vs :83-93 (zero), :171-180 (outputRates come from the raw recipe products) — Fix: say "after classification, before the LP". Note that it affects only the LP rows.
- [outdated] spec/solver.md:76-84 — The `'feed-back'` policy value, which is the UI default, is not mentioned. The solver does nothing with it. — src/data/schema.ts:183; src/solver/index.ts:85 (only `'discard'` is handled); src/components/factory/RecipeRow.tsx:409 (default `'feed-back'`) — Fix: add "`'feed-back'` (default) is a no-op for the solver".
- [wrong] spec/solver.md:84 — The doc says "The user can also pass an explicit list per plan". `noImportItems` now lives only on the `Block`, and legacy per-subplan lists are hoisted to it. — src/data/schema.ts:232-303, :316; src/solver/index.ts:27 — Fix: "per block". This also duplicates line 90, so merge the two.
- [outdated] spec/solver.md:84 — The doc does not say that `noImportItems` only matters for intermediates. Goals never have slack, and raw items have no LP row, so a bc-ingredient that is raw stays free. — src/solver/solve.ts:108-124; comment at src/solver/index.ts:102-106 — Fix: add that clause.
- [wrong] spec/solver.md:101-105 — The power formula is wrong. The code uses `machineCountExact`, not the ceiling. It adds machine `drainKw` (which consumption modules do not affect). It has **no** beacon-power term, and the field names are `energyUsageKw` / `drainKw`. — src/solver/effects.ts:89-93; test at src/solver/effects.test.ts:182-194 — Fix: `powerKw = machineCountExact · (energyUsageKw · (1 + consumptionBonus) + drainKw)`.
- [outdated] spec/solver.md:98-107 — Two things are undocumented. First, machine resolution: `planNode.machineId ?? gameData.defaultMachines[recipe.category]`, and if no machine is found the count and power are 0. Second, how effects are computed: module effect × count, plus beacon effect × `distributionEfficiency × modulesPerBeacon × beaconCount`, all additive. — src/solver/index.ts:153-164; src/solver/effects.ts:36-64 — Fix: add both briefly. Productivity is applied in `build.ts`, while speed and consumption are applied after the solve.
- [outdated] spec/solver.md:113 — The 150 ms debounce is correct. The doc does not mention that the store skips the solve entirely when there is no game data (status `idle`), no active block, or zero goals or zero nodes (it returns an empty result). It also does not mention that `lastResult` survives re-solves. — src/store/solverStore.ts:46, :60-80, :19-20 — Fix: one sentence.
- [outdated] spec/solver.md:88-92 — The `flattenBlock` description is correct, with one detail: it pushes every node, including `subplan` handles, and `solve()` filters on `kind === 'game-recipe'`. The docstring at index.ts:14 says it skips the handles, which it does not. — src/solver/index.ts:19-21, :37-38 — Fix (optional, code comment): correct the `flattenBlock` docstring. The spec wording can stay.
- [wrong] (code comments, not spec) src/solver/solve.ts:42,45 — The `solveLP` docstring says goal rows are `Σ S_ij x_j + s_i ≥ d_i` and leaves `BC_BONUS` out of the objective. Both contradict the code at :108-119 and :83. src/solver/effects.ts:17 names a non-existent `buildStoichiometryMatrix` (it is now `buildClassifiedSystem`). src/solver/build.ts:31 says "accounting for probability only", but the function also applies productivity. — Fix: correct the comments in step 4. The spec already states the right formulation.
- [outdated] (test hygiene) src/solver/index.test.ts:92-97 — A comment header with nothing under it; the real block is at :123. — Fix: remove it.

## spec/test-corpus.md

Bottom line: **none of the 6 cases is covered by any test today.** The corpus tests lived
in `src/solver/v1/index.test.ts` (`describe('solve — Case 1…5')`). They were deleted with
the v1 solver in commit `f55c2db` ("retire v1 solver in favour of v2"), and nothing was
ported to `src/solver/index.test.ts` or `solve.test.ts`. `effects.test.ts` checks the
`+0.40` productivity sum (case 6 setup) but never runs the solver. The only remaining
references are existence checks on the recipes in
`src/data/loader.integration.test.ts:39-90`.

I re-ran every case through today's `solve()` against the committed `game-data.json`,
with a speed-1, zero-power machine. **All expected values still match**: throughput,
exact machine count, and raw/unsatisfied rates for cases 1, 2, 3, 3b, 4, 5 and 6.

- [wrong] AGENTS.md:117 (and the corpus claim in CLAUDE.md) — "All 6 cases are covered in `src/solver/index.test.ts` and the individual module tests" is false. — `grep -rn "kovarex\|air-separation\|uranium-processing" src/solver` finds nothing; `git show f55c2db --stat` — Fix: the slim CLAUDE.md should not make this claim. Separately, recommend restoring the corpus as a solver test (synthetic recipes copied from the doc tables, so it does not depend on the git-ignored or large data). Track that in the backlog, not in this initiative.
- [wrong] spec/test-corpus.md:26-27, :63-66 — The recipe ids `nullius-iron-ingot-1`, `nullius-iron-plate-1`, `nullius-iron-rod-1` do not exist in the current export. Nullius dropped the `-1` suffix. — `game-data.json` has `nullius-iron-ingot`, `nullius-iron-plate`, `nullius-iron-rod` (same stoichiometry and times); src/data/loader.integration.test.ts:45 comment — Fix: rename the ids in the tables and derivations (lines 26-27, 33-34, 42-47, 63-66, 72-75, 87-94).
- [outdated] spec/test-corpus.md:3-4 — "verified against the raw `factorio --dump-data` output (see AGENTS.md …)" — AGENTS.md is being removed (D3). — Fix: point to the slim CLAUDE.md or to `scripts/build-game-data.js`.
- [outdated] spec/test-corpus.md:152, :198 — `kovarex-enrichment-process` and `uranium-processing` are `hidden: true` in the Nullius export, so they are base-game leftovers that Nullius players cannot use. — game-data.json `recipes[...].hidden === true` — Fix: add a note that cases 4–6 use hidden base recipes chosen for their properties (cycle, probability, `ignoredByProductivity`). They are still valid as solver tests.
- [wrong] spec/test-corpus.md:162, :251 (and :170-171) — Cases 4 and 6 call `uranium-238` a "raw resource". Kovarex both produces and consumes U-238, so `buildClassifiedSystem` classifies it as an **intermediate**. The 15/min (or 10.714/min) appears in `unsatisfied` through intermediate **slack** (BIG_M import), not through the raw-consumption pass. The number is the same but the mechanism is different. — src/solver/build.ts:100-111; src/solver/index.ts:210-214 — Fix: "External import: uranium-238 15/min (intermediate slack; U-238 is produced and consumed by the same recipe)".
- [wrong] spec/test-corpus.md:18, :37, :104 — The doc describes gravel and the case 3 extra outputs as "feed-back policy defaulting to discard" and "fed-back but discarded". The solver has no feed-back behaviour. These items are `byproduct`s (produced, never consumed) and are left out of the LP rows whatever the policy says. — src/solver/build.ts:107-108; src/solver/index.ts:83-93 (only `'discard'` handled) — Fix: "classified as byproduct (no consumer); excluded from LP rows".
- [outdated] spec/test-corpus.md:6-8 — "crafting_speed = 1, no modules" is correct for the expected numbers. Real default machines differ (for example, `centrifuging` → a machine with a different speed), so the solver's machine counts on real data will not match unless a speed-1 machine is forced. — src/solver/index.ts:153 — Fix: state explicitly that tests must override `machineId` with a speed-1 machine.

## spec/data-analysis.md

What it is: a one-time analysis of a raw `data-raw-dump.json`, written while the data
model was still a draft ("Corrections to the Draft Data Model", "Implications for the Lua
Export Script"). Most of its findings are now built into `scripts/build-game-data.js`
and `src/data/schema.ts`. The rest is history, and some of its counts no longer match
the committed export.

- [outdated] spec/data-analysis.md:3-4 — "~41 MB; see AGENTS.md for how to regenerate". AGENTS.md is going away (D3). — Fix: point to CLAUDE.md or `scripts/build-game-data.js`.
- [outdated] spec/data-analysis.md:6 — The dataset counts do not match the committed export. That file has **2371 recipes** (vs 2405 raw; parameter recipes are filtered out), **90 fluids** (vs 89), **34 modules** (vs 27), 2849 item-like entries including fluids (vs "1038 items"), and 1235 `allowProductivity` (vs 1220 at :54). Machines match: 136 = 101 + 33 + 2. — node count over `public/data/nullius/game-data.json` — Fix: drop the counts, or label them "raw dump, Nullius version at time of analysis".
- [outdated] spec/data-analysis.md:14 — "The export script uses runtime API so `energy` is correct there". That refers to the Lua exporter, which is removed (D1). The build script reads `energy_required`, defaulting to 0.5. — scripts/build-game-data.js:638 — Fix: delete the runtime-API sentence.
- [outdated] spec/data-analysis.md:22, :33, :67 — "The importer must parse…", "should default to 0", "Filter these out". All of these are done: `parseEnergyKw` handles W, kW, MW, GW and TW; `module_slots ?? 0`; `if (proto.parameter) continue`. — scripts/build-game-data.js:357-371, :557, :604 — Fix: rephrase as facts ("the build script parses…"), or drop them.
- [wrong] spec/data-analysis.md:54 — "The solver must check [allow_productivity]". The solver never checks it; `computeNodeEffects` adds productivity unconditionally. The check is done in the UI, which zeroes productivity when the recipe disallows it. — src/solver/effects.ts:42-48; src/components/factory/EditMachineModal.tsx:41; src/components/factory/BeaconModal.tsx:102 — Fix: "The machine/beacon modals zero productivity for such recipes; the solver trusts the node config".
- [outdated] spec/data-analysis.md:61-63 — The doc says absent `main_product` is resolved at use time. The build script now resolves it at export time: single-product recipes get an explicit `mainProduct`, `""` stays as the multi-output marker (5 recipes, which matches), and the schema maps `""` to `null`. — scripts/build-game-data.js:443-450; src/data/schema.ts (mainProduct transform) — Fix: describe the exported shape instead.
- [wrong] spec/data-analysis.md:71 — "treat as equivalent to … `amount_min + (amount_max - amount_min) / 2`". The build script actually uses `amount ?? amount_max` and stores `amountMin`/`amountMax`. The solver reads only `amount`. — scripts/build-game-data.js:410-415; src/solver/build.ts:70-75 — Fix: state the real behaviour, or delete the paragraph (no Nullius product uses these: 0 in the export).
- [outdated] spec/data-analysis.md:122-131 — The whole "Implications for the Lua Export Script" section is obsolete (D1). — Fix: delete it.
- [misplaced] spec/data-analysis.md (whole file) — It is framed as a history/decision log ("Corrections to the Draft Data Model"), which breaks the "spec/ is timeless" rule. The parts still worth keeping are: energy strings parsed to kW; categories are open strings (56 in the export); `parameter` recipes filtered; `main_product` shapes; `ignored_by_productivity` semantics (3 products in the export); `fluidbox_index` and `ignored_by_stats` ignored; quality absent in Nullius. — Fix (recommended): fold those facts into a short "Source-data quirks" section of `spec/data-model.md` and delete `data-analysis.md`. If history is wanted, `git mv` it to `initiatives/archive/` instead.

## spec/solver-chains/

- [broken-link] spec/solver-chains/README.md:33, :54 — These lines reference `src/solver/index.integration.test.ts`, which does not exist. Its predecessor `src/solver/v1/index.integration.test.ts` was deleted in `f55c2db`. — `git show f55c2db --stat` — Fix: see the D4 recommendation below.
- [wrong] spec/solver-chains/README.md:3-5 — "used as an integration test fixture for the solver". No test, script or e2e spec loads `src/solver/__fixtures__/*.fixture.json`. — `git grep "__fixtures__"` only matches docs and `scripts/trace-recipe-chain.js` comments — Fix: see D4.
- [wrong] spec/solver-chains/README.md:39-41 vs the chain files — The "Raw inputs" column contradicts the chain docs. automation-science-pack.md:15 says "none"; the README says iron-ore and copper-ore. It also contradicts what the solver produces today: chemical gives `water, copper-cable, crude-oil, coal, iron-ore` as unsatisfied (README: `coal`), and logistic gives `nullius-plastic, iron-ore` (README: `iron-ore`). — probe run of `solve()` on each fixture — Fix: see D4.
- [wrong] spec/solver-chains/README.md:75-77 — The doc says the solver "feeds all byproducts back by default (policy `feed-back`)". `feed-back` is only the UI default label. The solver ignores it, and byproducts with no consumer are left out of the LP. — src/solver/index.ts:83-93; src/solver/build.ts:107-108 — Fix: see D4.
- [outdated] spec/solver-chains/*.md — The chains trace **hidden base-game recipes**: every vanilla recipe they use (`automation-science-pack`, `iron-gear-wheel`, `iron-plate`, `copper-plate`, `chemical-science-pack`, `sulfur`, `basic-oil-processing`, …) is `hidden: true` in the Nullius export. The default machines they print are also stale: automation-science-pack.md:34,39 says `steel-furnace`, but `defaultMachines.smelting` is now `electric-furnace`. logistic and chemical mix vanilla and Nullius recipes into chains no Nullius player would build. — node check over `game-data.json` — Fix: see D4.
- [wrong] scripts/trace-recipe-chain.js:9, :24 — The script header says output goes to `spec/solver-chains/<name>.fixture.json`; the README says `src/solver/__fixtures__/`. — Fix: delete it along with the chains (D4), or fix the header.

---

## D4 recommendation: spec/solver-chains/

**Recommendation: delete** `spec/solver-chains/` (README and the 3 chain docs). In the
same step, also delete the unused `src/solver/__fixtures__/` (all 4 files) and
`scripts/trace-recipe-chain.js`.

What they are: output of `scripts/trace-recipe-chain.js`, added in `908bc74` ("solver
integration tests with traced Nullius recipe chains"). Each `.md` is a dependency tree
plus an embedded copy of the matching `src/solver/__fixtures__/<name>.fixture.json`. I
checked all 3, and each embedded copy is byte-identical in JSON to its file. The fixtures
were loaded by `src/solver/v1/index.integration.test.ts`. Its assertions were loose: the
goal output is about 60/min, no warnings, and `coal` appears in unsatisfied. The docs
contain **no throughput or machine numbers** at all.

Reasons to delete rather than update:

1. **Nothing uses them.** The integration test was deleted with v1 in `f55c2db` and never
   ported. `git grep __fixtures__` finds no consumer. The 4th fixture,
   `nullius-ethylene-methane.fixture.json`, has no doc and no consumer either. Its live
   counterpart is `e2e/fixtures/nullius-ethylene-methane-v2.json`, which
   `e2e/lp-solver-overconstrained.spec.ts` uses.
2. **They do not represent Nullius.** The chains are built from hidden vanilla recipes,
   so they test nothing a user of this app would build.
3. **They are already inconsistent.** The README's raw-input table disagrees with the
   chain docs and with today's solver output. The README describes byproduct semantics
   wrongly, and the docs name stale default machines.
4. **The tracer encodes a different idea.** It picks one "default producer" per item and
   detects cycles. With the LP solver, cycles and alternatives are handled by the
   solver itself.
5. **The fixtures still solve without error** (all recipe ids exist; no warnings for the 3
   science chains). So deleting them removes no regression signal, because no assertion
   depends on them.

If real-data regression coverage is wanted later, the better option is to restore the
**test corpus** as solver unit tests. Those have exact expected values, and every one
still matches today's solver. A real-data integration test could be added with a
Nullius-native chain chosen by hand. Record this as a backlog item (step 5), not as
docs.

Follow-on edits if D4 = delete: remove `trace-recipe-chain.js` from the AGENTS.md/CLAUDE.md
layout line (AGENTS.md:43), and drop the `solver-chains/` mention from plan.md step 4.
