# Initiative: Flatten subplans — global LP, subplans as UI grouping

Status: Shipped — commit `fb79152`.

---

## Outcome (shipped)

Implemented as designed; one commit. Test suite: 235 unit + 41 e2e green; lint + Vite build clean. Deviations from the original plan:

- **Solver entry point**: shipped as `solve(plan, gameData)` with a separate `flattenBlock(block): SolverPlan` helper in [src/solver/index.ts](../../src/solver/index.ts), rather than `solve(block, gameData)`. Keeps existing solver tests easy to write (they pass `{goals, nodes}` directly without constructing a Block).
- **Persistence**: no schema-version bump. The `BlockSchema` preprocess hoists legacy `rootPlan.goals` / `rootPlan.noImportItems` on load; existing e2e fixtures (which still carry the old shape) parse unchanged and surface goals at block level.
- **Vestigial `pinnedRate` on `SubPlanNode`**: removed as part of the schema cleanup (was never read by the solver). Zod silently strips it from old persisted nodes.
- **`subplan-empty-state.spec.ts`**: deleted (was already `test.skip()` pending a port that never happened).
- **Regression test**: [src/solver/index.test.ts](../../src/solver/index.test.ts) gained both the wrap-in-subplan parity assertion (the bug the user hit) and a `flattenBlock` tree-walk sanity test.

---

## Context

The current solver treats each `SubPlan` as a self-contained problem: bottom-up post-order traversal, each child subplan solves in isolation, then its net inputs/outputs are frozen into a `SyntheticRecipe` (one variable, one scale knob) that the parent LP consumes. This was inherited from the matrix-era design and was preserved during the LP migration; the `subPlans` field still works as a hard solve boundary.

**The leak that prompted this work.** A user moved a single recipe into its own subplan purely for *categorization*. The recipe stopped running (throughput → 0). Mechanism: a subplan with no `goals` produces a synthetic recipe whose products nothing in the parent demands. The LP minimises Σx_j, so x = 0 is optimal. Reorganising the tree shouldn't change what gets produced, but in the current model it does.

**Net effect of the current model on the UI.** The Explore agent's pass shows the per-subplan UI machinery is mostly vestigial. There is no sidebar of subplans, no breadcrumb, no drill-in. `activeSubPlanId` exists as flat per-block state but has no UI affordance to change it; child subplans render via inline expand/collapse in `ProductionTable`. The only thing per-subplan focus actually scopes today is which goals/ingredients/byproducts/warnings panel content is computed — and that scoping is precisely what creates the leak above.

**Decision.** Make subplans a pure UI/persistence grouping. One global LP per `Block`. All goals roll up to block level. `activeSubPlanId` and its scoping logic go away. `wrapNodeInSubPlan` and friends stay as an organisational gesture with no solver impact.

---

## Outcome

- Reorganising nodes into / out of subplans never changes solver output.
- Goals, ingredients, byproducts, warnings, balanced-items footer all show one block-wide picture.
- Subplan rows in `ProductionTable` keep their inline expand/collapse behaviour as a visual grouping.
- The `subplan.ts` synthetic-recipe machinery is deleted.
- Cross-subplan cycles (currently impossible because child output is frozen before parent runs) become solvable for free.

---

## What stays unchanged

- `Block` / `SubPlan` / `SubPlanNode` schema shape, except `SubPlan.goals` (see below).
- `RecipeNode` shape and per-node knobs (`pinnedRate`, `byproductPolicy`, `byproductConsumer`, modules, beacons).
- `noImportItems` — relocated from per-subplan to per-block.
- LP formulation in [src/solver/build.ts](src/solver/build.ts) and [src/solver/solve.ts](src/solver/solve.ts).
- `wrapNodeInSubPlan`, `createSubPlan`, `removeSubPlan`, etc. in `blockStore` — kept as cosmetic operations.
- Inline expand/collapse of `SubPlanNode` rows in `ProductionTable`.

---

## Schema changes

[src/data/schema.ts](src/data/schema.ts#L189-L233):

- `SubPlan.goals` → removed. Goals live on `Block` only.
- `SubPlan.noImportItems` → removed. Move to `Block.noImportItems`.
- `Block` gains `goals: ProductionGoal[]` and `noImportItems: string[]`.
- `SubPlan` retains: `id`, `name`, `nodes`, `subPlans`, `createdAt`, `updatedAt`. It is now purely an organisational container.
- Backwards-compat: schema preprocess hoists each loaded plan's `rootPlan.goals` and `rootPlan.noImportItems` up to `Block`, then walks nested `subPlans` and concatenates any stray goals into the same block-level array (deduped by itemId, summing rates if duplicated). Older persisted plans continue to load.

---

## Solver changes

[src/solver/index.ts](src/solver/index.ts):

- `solve(plan, gameData, syntheticRecipes?)` → `solve(block, gameData)`.
- Internally: walk `block.rootPlan` recursively, collect every `RecipeNode` (skip `SubPlanNode` entries, since they're now just grouping handles), pass that flat list to `buildClassifiedSystem`.
- Goals come from `block.goals`; `noImportItems` from `block.noImportItems`.
- The synthetic-recipe loop at [src/solver/index.ts:191-210](src/solver/index.ts#L191-L210) is deleted.
- Result `SolvedNode[]` is keyed by `recipeNodeId` exactly as today; the UI maps node id → its enclosing subplan via the tree, which is a pure-data lookup.

[src/solver/subplan.ts](src/solver/subplan.ts): **deleted** along with its tests.

[src/store/solverStore.ts](src/store/solverStore.ts#L54-L78): `solveBottomUp` deleted. `subPlanResults: Map<string, SolverResult>` collapses to a single `lastResult: SolverResult` per active block. Subscription wiring stays the same shape; just calls `solve(block, gameData)` once.

---

## Store changes

[src/store/blockStore.ts](src/store/blockStore.ts):

- Drop `activeSubPlanId`, `selectActiveSubPlan`, `setActiveSubPlan`.
- Goal mutators (`addGoal`, `removeGoal`, `setGoalRate`) now write to `Block.goals` rather than the active subplan's `goals`.
- `noImportItems` mutators write to `Block.noImportItems`.
- `wrapNodeInSubPlan`, `createSubPlan`, `removeSubPlan`, `findSubPlanDeep` — kept; only their effect-on-solver disappears.
- Persistence: bump schema version; migration walks loaded plans and lifts goals/noImportItems to block level.

---

## UI changes

All "active subplan" scoping moves to "active block":

- [src/components/factory/FactorySummary.tsx](src/components/factory/FactorySummary.tsx#L244-L299) — goals input, byproducts pane, ingredients pane all read `block.goals` and the single block-level `solverResult`.
- [src/components/factory/BalancedItemsFooter.tsx](src/components/factory/BalancedItemsFooter.tsx) — warnings + balanced items also block-level.
- [src/components/factory/ProductionTable.tsx](src/components/factory/ProductionTable.tsx#L34) — `nodes` source becomes `block.rootPlan` traversed depth-first, with `SubPlanNode` rows still rendered as inline expandable headers (existing `expanded` state in [ProductionTable.tsx:22](src/components/factory/ProductionTable.tsx#L22) stays). The table now always shows the whole block; expand/collapse only affects which descendants are visible.
- [src/components/factory/RecipeRow.tsx](src/components/factory/RecipeRow.tsx#L58-L91) — `SubPlanNode` rendering unchanged in look, just no longer linked to any "focus" action (already isn't).

No new components. No drill-in, breadcrumb, or sidebar work — those were never built.

---

## Tests

- [src/solver/index.test.ts](src/solver/index.test.ts) — drop `syntheticRecipes` test cases; add a flattening test: nesting an isolated recipe in a subplan must produce identical solver output to the unwrapped version. This is the regression that started this initiative; it should be the first test written.
- [src/store/solverStore.test.ts](src/store/solverStore.test.ts), [src/store/blockStore.test.ts](src/store/blockStore.test.ts), [src/store/persistence.test.ts](src/store/persistence.test.ts) — update for removed `activeSubPlanId`, hoisted goals, and the persistence migration. Persistence test should round-trip an old-format plan and assert goals end up at block level.
- `src/components/factory/*.test.tsx` — update fixtures: remove `activeSubPlanId` from store stubs, attach goals to block.
- [e2e/subplan-empty-state.spec.ts](e2e/subplan-empty-state.spec.ts) — currently `test.skip()`; either delete (the empty-state warning likely no longer applies) or repurpose to assert that an empty subplan does not affect solver output. Recommend delete.

---

## Risks

- **Persistence migration**: any saved plans with subplan-level goals must be migrated cleanly. The migration is one tree-walk and rate-sum; not deep, but worth a focused unit test on real exported fixtures (e.g. [initiatives/archive/lp-solver/factorio-plan-2026-04-26-15-09.json](initiatives/archive/lp-solver/factorio-plan-2026-04-26-15-09.json)).
- **Subplan internal byproducts becoming globally visible.** Today a surplus produced and consumed inside a subplan is invisible in the parent. After flattening it joins the global balance. In practice this is what the user wants — sibling subplans *should* see each other's byproducts — but it could surprise users with carefully isolated subplans. Mitigation: existing `byproductPolicy = 'discard'` and `noImportItems` already cover the cases where users want to opt out of cross-pollination.
- **Loss of "scale as a unit" semantics.** A subplan no longer has a single throughput knob. If anyone actually relied on this, it can be reintroduced later as an opt-in `mode: 'module' | 'group'` flag. YAGNI says don't build it now.

---

## Verification

End-to-end:
1. `npm run test` — all unit tests green; new flattening regression test in `src/solver/index.test.ts` passes.
2. `npm run test:e2e` — Playwright suite green after fixture/spec updates.
3. Manual repro of the original bug: in dev (`npm run dev`), build a plan with one recipe meeting one goal; wrap that recipe in a subplan via `wrapNodeInSubPlan`; verify throughput is identical before and after.
4. Load a pre-migration plan (use the lp-solver archive fixture) and verify goals appear at block level with correct rates.
5. Verify cross-subplan flow works: two sibling subplans where one's product is the other's ingredient — global LP should balance them automatically.

---

## Files touched

Modified:
- [src/data/schema.ts](src/data/schema.ts)
- [src/solver/index.ts](src/solver/index.ts)
- [src/store/solverStore.ts](src/store/solverStore.ts)
- [src/store/blockStore.ts](src/store/blockStore.ts)
- [src/components/factory/FactorySummary.tsx](src/components/factory/FactorySummary.tsx)
- [src/components/factory/BalancedItemsFooter.tsx](src/components/factory/BalancedItemsFooter.tsx)
- [src/components/factory/ProductionTable.tsx](src/components/factory/ProductionTable.tsx)
- [spec/solver.md](spec/solver.md) — rewrite the "Sub-plans" section to describe grouping-only semantics
- [spec/tech-stack.md](spec/tech-stack.md) — drop `subplan.ts` from the file tree
- [AGENTS.md](AGENTS.md) — update the `solve(...)` signature line

Deleted:
- [src/solver/subplan.ts](src/solver/subplan.ts)
- `src/solver/subplan.test.ts` (if present)
- [e2e/subplan-empty-state.spec.ts](e2e/subplan-empty-state.spec.ts)
- The `SyntheticRecipe` type export from [src/solver/index.ts](src/solver/index.ts)

Test fixtures touched in:
- `src/store/*.test.ts`, `src/components/factory/*.test.tsx`, `src/store/persistence.test.ts`
