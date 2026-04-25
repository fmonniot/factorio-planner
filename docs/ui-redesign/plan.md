# Factory-Planner-Style UI Redesign

## Context

The current UI splits production data across several surfaces (PlansTree, GoalsPanel, NodesPanel, TreeView/TableView, RecipeCard, SummaryBar). It uses a hierarchical sidebar tree and collapsible recipe cards. The user wants to converge on the dense, columnar layout of the Factorio mod *Factory Planner* (helmod-style): a flat subfactory list on the left, a tri-section summary header on the right, and a single dense production table with one row per recipe and inline columns for machine, beacon, products, byproducts, and ingredients. Floor drill-in replaces the sidebar tree for nested production breakdowns.

The solver (`src/solver/*`) and the underlying data model (`src/data/schema.ts` — `Block`, `SubPlan`, `RecipeNode`, `SubPlanNode`, `ProductionGoal`) are already well-suited to this UI; this is a presentation refactor, not a solver/data refactor. Existing nested SubPlan data is preserved — drilling into a recipe row navigates into its child SubPlan.

## Decisions (from clarifying Q&A)

- **Layout**: flat subfactory list on the left + Floor/Level drill-in on the right.
- **Recipe rows**: dense, inline columns (no collapsible card).
- **Toggles**: `/sec ⇄ /min` only. Skip Items/s/machine and Solver-mode toggles for now.
- **Scope**: full replacement — TreeView/TableView/GoalsPanel/NodesPanel/RecipeCard/SummaryBar are removed.
- **Floors = SubPlans**: drilling a recipe row navigates into that node's child SubPlan; only top-level subplans appear in the sidebar list.
- **Goals/Nodes integration**: Goals → `[+]` in the header's Products box. New recipes → `[+]` row at the bottom of the production table.
- **BlockTabs**: kept, moved to the top-left corner replacing the unused pin/play/resize game-chrome icons.

## Target layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [BlockTab1│BlockTab2│+]              Factory Planner       [Prefs][GameData]│  ← TopBar
├──────────────┬──────────────────────────────────────────────────────────────┤
│ District: …  │  ┌─ Factory Summary ─────────────────────────────────────┐  │
│  [+][✎][⎘][🗑]│  │ /sec ◯ /min   Products | Byproducts | Ingredients   │  │
│ ─────────────│  └────────────────────────────────────────────────────────┘  │
│ ▶Chemistry◀ │  ┌─ Production  Level N  ↑ ⤒ ────────────────────────────┐  │
│  Iron ingot  │  │ Recipe │ Machine │ Beacon │ Products │ Byprod │ Ingr │  │
│  Lubricant   │  │  …rows with inline editors via popovers…             │  │
│  Plastic     │  │ [+ add recipe]                                         │  │
│  Methane     │  └────────────────────────────────────────────────────────┘  │
│ ─────────────│  Unrestricted items balanced ⓘ  [tile][tile]…              │
│ Search:[___] │                                                              │
└──────────────┴──────────────────────────────────────────────────────────────┘
```

## File-level plan

### New components (`src/components/factory/`)
- `FactoryShell.tsx` — replaces `AppShell`. Two-pane grid (sidebar + main). Hosts `TopBar`, `SubfactorySidebar`, `FactoryMain`.
- `TopBar.tsx` — left-aligned `BlockTabs` (relocated), centered title, right-aligned game-data picker + Preferences. Replaces current `AppShell` header.
- `SubfactorySidebar.tsx` — flat list. Renders top-level SubPlans of the active block. Toolbar (`add`, `rename`, `duplicate`, `delete`) + `Search` input filtering by name. Selecting a row sets `activeSubPlan`.
- `FactorySummary.tsx` — three boxes side by side:
  - **Products**: tiles for each `ProductionGoal` of the active subplan + `[+]` opens `ItemPicker` to add a goal.
  - **Byproducts**: tiles for solver-reported net surplus (red-tinted).
  - **Ingredients**: tiles for unsatisfied/raw inputs (green-tinted).
  - Top-right `/sec ⇄ /min` toggle (sets a UI preference in a new `uiStore`).
- `ProductionTable.tsx` — header `⚙ Production  Level N  ↑ ⤒` + table with the new column set. Bottom row: `[+ add recipe]` opening a recipe picker.
- `RecipeRow.tsx` — single dense row. Columns: reorder ↕, enable ☐, recipe icon (click → recipe alternates popover), machine cell (icon + count + module-slot button → opens `ModulePopover`), beacon cell (`[+]` or summary, click → `BeaconPopover`), products tiles, byproducts tiles, ingredients tiles, electricity tile. Clicking a byproduct toggles `byproductPolicy`. Clicking the recipe icon when it has a child SubPlan drills in (sets active floor).
- `ItemTile.tsx` — small primitive: icon + rate, color variant `{product|byproduct|ingredient|electricity}`. Honors the `/sec ⇄ /min` toggle.
- `ModulePopover.tsx`, `BeaconPopover.tsx`, `MachinePopover.tsx` — extracted editors from today's `RecipeCard`. Same logic, popover chrome.
- `FloorBreadcrumb.tsx` — `Level N  ↑ ⤒` controls. Drives a new `activeFloorPath: string[]` (chain of SubPlan ids from root → current).
- `BalancedItemsFooter.tsx` — replaces `SummaryBar`'s "balanced items" tail; just the diagnostic tile list.

### Components to remove
- `AppShell.tsx` (replaced by `FactoryShell`)
- `PlansTree.tsx`, `GoalsPanel.tsx`, `NodesPanel.tsx`
- `TreeView.tsx`, `TableView.tsx`
- `RecipeCard.tsx` (logic split into `RecipeRow` + popovers)
- `SummaryBar.tsx` (split into `FactorySummary` + `BalancedItemsFooter`)

### Reused as-is
- `ItemPicker.tsx` — for goal creation and recipe selection (may need a recipe-mode flag).
- All of `src/store/blockStore.ts` — every mutation needed (addGoal, addNode, updateNodeMachine, …) already exists.
- All of `src/solver/*` — no changes.
- `src/data/schema.ts` — no changes.

### State additions
New `src/store/uiStore.ts` (zustand, persisted):
- `rateUnit: 'sec' | 'min'` (default `'min'`)
- `activeFloorPath: string[]` (subplan ids, root → current; empty = at top-level subplan)

`blockStore` gains one helper:
- `navigateToFloor(subPlanId)` and `navigateUp()` / `navigateToRoot()` — write to `uiStore.activeFloorPath`. (Or expose pure helpers; `activeSubPlan` derives from `activeFloorPath[last]`.)

### Wiring
- `main.tsx` mounts `<FactoryShell />` instead of `<AppShell />`.
- `App.tsx` becomes a thin pass-through or is folded into `FactoryShell`.
- The existing solver subscription in `wireSolver()` keeps working — it watches `activeSubPlan`, which now comes from `activeFloorPath`.

### Styling
- Tailwind utility classes consistent with current code. Color tokens for tile variants (green/red/neutral/teal). One small CSS module for the popover chrome if Tailwind alone is awkward.

## Critical files to modify

- `src/main.tsx` — swap shell.
- `src/App.tsx` — fold or thin out.
- `src/store/blockStore.ts` — add floor-nav helpers.
- `src/store/uiStore.ts` — **new**.
- `src/components/factory/*` — **new** (all components above).
- `e2e/*.spec.ts` — update selectors. Existing specs (`nodes-panel`, `goals`, `subplan-empty-state`, `primary-product-override`, `warnings-popover`) reference DOM nodes that will move; update locators rather than rewriting test intent.
- `src/components/AppShell.tsx`, `PlansTree.tsx`, `GoalsPanel.tsx`, `NodesPanel.tsx`, `TreeView.tsx`, `TableView.tsx`, `RecipeCard.tsx`, `SummaryBar.tsx` — **delete**.

## Implementation order (within the single PR)

1. `uiStore` + floor-path nav helpers in `blockStore`. Unit-test the new helpers.
2. `ItemTile`, popovers (Machine/Module/Beacon) — pure presentational, no layout dependence.
3. `RecipeRow` using primitives. Snapshot/component test against a known solver result.
4. `ProductionTable` + `FloorBreadcrumb` + add-recipe row.
5. `FactorySummary` + `BalancedItemsFooter` + rate-unit toggle.
6. `SubfactorySidebar` (flat list, search, toolbar).
7. `TopBar` with relocated `BlockTabs`.
8. `FactoryShell` wires it all; swap `main.tsx`.
9. Update e2e selectors; delete removed components.
10. Run full test suite (`npm test`), then manual verify in `npm run dev`.

## Verification

- **Unit**: `npm run test:unit` — all solver/store tests must still pass; new tests for `uiStore` floor navigation.
- **E2E**: `npm run test:e2e` — every existing spec updated to new DOM, all green. Pay special attention to `subplan-empty-state.spec.ts`, `nodes-panel.spec.ts`, `primary-product-override.spec.ts`, `warnings-popover.spec.ts`, `plan-export.spec.ts`.
- **Manual**: `npm run dev`, then exercise:
  - Create a block → add a subfactory → add a goal via `Products [+]` → verify summary populates and rows appear after adding recipes.
  - Change machine count, modules, beacons via popovers — solver result updates live.
  - Add a child subplan; click into the parent recipe row → drill into Level 2 → use `↑` and `⤒` to navigate back.
  - Toggle `/sec ⇄ /min` and confirm all `ItemTile` rates re-render.
  - Multi-block switching via the relocated `BlockTabs`.
  - Search the subfactory sidebar and confirm filtering.

## Out of scope (follow-ups)

- `Items/s ⇄ Items/s/machine` toggle.
- `Solver: Traditional ⇄ Matrix` toggle (would require a new solver path).
- Visual polish: drag-to-reorder rows, dark/light theming beyond current.
- District-as-data layer above Block.

---

# Ticket breakdown

The work is split into tickets sized so a single Sonnet 4.6 session can complete each one end-to-end (read context → implement → verify). Each ticket lists prerequisites, scope, files, and success criteria.

Ticket execution order respects the dependency graph below. Tickets without a shared prerequisite can be done in parallel, but the recommended path is sequential because later tickets verify earlier ones in the dev server.

```
T01 ──► T02 ──┐
T03 ──────────┼──► T04 ──► T05 ──► T06 ──► T07 ──► T08 ──► T09 ──► T10
              │
T01 ──► T03 ──┘
```

## Conventions for every ticket
- Branch from `main`. Open one PR per ticket.
- After implementation: `npm run test:unit` must pass. If the ticket lists e2e impact, `npm run test:e2e` must pass.
- No new components in `src/components/factory/` may import from the legacy components scheduled for deletion (`AppShell`, `PlansTree`, `GoalsPanel`, `NodesPanel`, `TreeView`, `TableView`, `RecipeCard`, `SummaryBar`).
- Legacy components keep working until **T09**; the app continues to mount the old shell until **T08**.
- Tailwind classes only; no new CSS files unless explicitly noted.

---

## T01 — Save plan & ticket breakdown into the repo
**Prerequisites:** none.
**Scope:** Copy the contents of this plan file into `docs/ui-redesign/plan.md` in the repo. Create the directory if missing. Update the repo `README.md` (or add a `docs/README.md` if there is no top-level docs index) with a single link to the new plan.
**Files:** `docs/ui-redesign/plan.md` (new), possibly `docs/README.md` (new) or `README.md` (edit one line).
**Success criteria:**
- `docs/ui-redesign/plan.md` exists and matches this plan verbatim.
- `git status` shows only the new docs files.
- No code under `src/` is modified.

## T02 — `uiStore` (rate unit + floor path)
**Prerequisites:** T01.
**Scope:** New zustand store at `src/store/uiStore.ts` with:
- `rateUnit: 'sec' | 'min'`, default `'min'`, persisted to localStorage under key `factorio-planner:ui`.
- `setRateUnit(u)`.
- `activeFloorPath: string[]` (subplan ids, root → current). Default `[]`.
- `pushFloor(subPlanId)`, `popFloor()`, `resetFloor()`, `setFloorPath(path)`.
Wire persistence the same way `persistence.ts` does for blocks (load on startup in `main.tsx`, subscribe to autosave).
**Files:** `src/store/uiStore.ts` (new), `src/store/uiStore.test.ts` (new), `src/main.tsx` (load on startup), `src/store/persistence.ts` if a shared helper makes sense.
**Success criteria:**
- Unit tests cover all five mutations and persistence round-trip.
- `npm run test:unit` passes.
- `localStorage` is read on startup; restoring a saved `rateUnit` works in a manual `npm run dev` smoke test.
- No UI changes visible to the user yet.

## T03 — Floor-nav helpers in `blockStore`
**Prerequisites:** T01.
**Scope:** Add helpers to `src/store/blockStore.ts`:
- `getActiveSubPlan(state): SubPlan | undefined` — derived from `uiStore.activeFloorPath` (last id) falling back to current `activeSubPlanId` for back-compat. Live alongside, do not yet replace existing logic.
- Selector `useActiveSubPlanFromFloor()` exported for components.
Pure, no breaking changes to existing API.
**Files:** `src/store/blockStore.ts`, `src/store/blockStore.test.ts`.
**Success criteria:**
- Unit tests demonstrate selector behavior with empty path, single-element path, deep path.
- `npm run test:unit` passes.
- No existing test fails.
- No UI changes.

## T04 — Presentational primitives: `ItemTile` + popovers
**Prerequisites:** T02.
**Scope:** Create the leaf components used everywhere later:
- `src/components/factory/ItemTile.tsx` — props: `{ itemId, ratePerSec, variant: 'product'|'byproduct'|'ingredient'|'electricity', onClick?: () => void }`. Reads `rateUnit` from `uiStore` to format the displayed number. Uses the existing item icon resolver (find it in current code; reuse, do not duplicate).
- `src/components/factory/MachinePopover.tsx` — extracted machine selector + count input from `RecipeCard`. Same logic, popover chrome.
- `src/components/factory/ModulePopover.tsx` — extracted module editor.
- `src/components/factory/BeaconPopover.tsx` — extracted beacon editor.
- Optionally a small `Popover.tsx` primitive (tailwind + portal) if no existing one fits.
**Files:** new files under `src/components/factory/`.
**Success criteria:**
- Each popover has a Vitest component test rendering it with mock state and asserting one mutation flows to `blockStore`.
- `ItemTile` snapshot test for each variant + both rate units.
- No legacy component imports the new ones yet.
- `npm run test:unit` passes.

## T05 — `RecipeRow`
**Prerequisites:** T03, T04.
**Scope:** `src/components/factory/RecipeRow.tsx` rendering one production-line row with the exact column set described in the plan: reorder ↕, enable ☐, recipe icon, machine cell (opens `MachinePopover` + module slots that open `ModulePopover`), beacon cell (`[+]` or summary, opens `BeaconPopover`), products tiles, byproducts tiles, ingredients tiles, electricity tile.
- Click on the recipe icon when the node is a `SubPlanNode` calls `pushFloor(subPlanId)`.
- Click on a byproduct tile toggles `byproductPolicy` for that item via existing `updateNodeByproductPolicy`.
- Reorder arrows call existing `blockStore` reorder action (verify it exists; if not, add it as part of this ticket).
**Files:** `src/components/factory/RecipeRow.tsx`, test file.
**Success criteria:**
- Component test mounts a row against a fixture solver result and asserts: each column renders, popovers open, byproduct click flips policy in store, drill-in click pushes the floor.
- No legacy component is modified or removed.
- `npm run test:unit` passes.

## T06 — `ProductionTable` + `FloorBreadcrumb`
**Prerequisites:** T05.
**Scope:**
- `src/components/factory/FloorBreadcrumb.tsx` — `Level N`, `↑` (popFloor), `⤒` (resetFloor) controls. Hidden when floor depth is 0.
- `src/components/factory/ProductionTable.tsx` — header row with column titles, a `RecipeRow` per node of the active subplan (resolved via T03 selector), and an `[+ add recipe]` row at the bottom that opens `ItemPicker` in recipe-mode and calls `addNode`.
- If `ItemPicker` doesn't already support recipe-mode, add a `mode: 'item' | 'recipe'` prop while preserving existing usage.
**Files:** new files in `src/components/factory/`, possibly `src/components/ItemPicker.tsx` (additive change only).
**Success criteria:**
- Component test: an empty subplan shows only the add-recipe row; adding a recipe via the picker creates a node and a row appears.
- `FloorBreadcrumb` integration test: pushFloor → breadcrumb appears with Level 2; popFloor → returns to Level 1.
- `npm run test:unit` passes.

## T07 — `FactorySummary` + `BalancedItemsFooter`
**Prerequisites:** T04.
**Scope:**
- `src/components/factory/FactorySummary.tsx` — three-pane header (Products / Byproducts / Ingredients). Reads from solver result + active subplan goals. Products box has `[+]` opening `ItemPicker` to call `addGoal`. Top-right `/sec ⇄ /min` toggle bound to `uiStore.setRateUnit`.
- `src/components/factory/BalancedItemsFooter.tsx` — narrow strip showing solver "balanced items" tiles, equivalent to today's `SummaryBar` tail.
**Files:** new files in `src/components/factory/`.
**Success criteria:**
- Component test for `FactorySummary` against a fixture solver result: each box populates correctly; clicking `[+]` invokes `addGoal`; toggling rate unit mutates `uiStore`.
- `BalancedItemsFooter` test against a fixture.
- `npm run test:unit` passes.

## T08 — `SubfactorySidebar` + `TopBar` + `FactoryShell`
**Prerequisites:** T06, T07.
**Scope:**
- `src/components/factory/SubfactorySidebar.tsx` — flat list of top-level subplans of the active block. Toolbar buttons: add (calls existing `addSubPlan`), rename, duplicate, delete. Search input filtering by name (client-side). Selecting a row calls `setFloorPath([subPlanId])`. Highlight the active row.
- `src/components/factory/TopBar.tsx` — left-aligned `BlockTabs` (relocated, import the existing component as-is). Right-aligned: existing game-data picker + Preferences entry. No window-chrome icons.
- `src/components/factory/FactoryShell.tsx` — assembles `TopBar`, `SubfactorySidebar`, `FactorySummary`, `FloorBreadcrumb`, `ProductionTable`, `BalancedItemsFooter` into the two-pane grid in the plan.
- Switch `src/main.tsx` to mount `<FactoryShell />` instead of `<AppShell />`. **`AppShell` and the legacy panels are still in the tree of files but no longer rendered.**
**Files:** new files in `src/components/factory/`, `src/main.tsx`.
**Success criteria:**
- `npm run dev` shows the new layout end-to-end.
- Manual smoke test: select a subplan, add a goal, add a recipe, change machine count via popover, drill into a child subplan, navigate back, toggle `/sec ⇄ /min`, switch blocks via the tab strip, search the sidebar.
- All unit tests pass.
- E2E tests are expected to fail at this point — that's handled in T09.

## T09 — Update e2e tests + delete legacy components
**Prerequisites:** T08.
**Scope:**
- Update Playwright selectors in every spec under `e2e/*.spec.ts` to match the new DOM. Test intent should not change; only locators.
- Delete: `AppShell.tsx`, `PlansTree.tsx`, `GoalsPanel.tsx`, `NodesPanel.tsx`, `TreeView.tsx`, `TableView.tsx`, `RecipeCard.tsx`, `SummaryBar.tsx`, plus their unit tests if they exist.
- Remove any imports of those components from `App.tsx` / `main.tsx` and either fold `App.tsx` into `FactoryShell` or thin it to a pass-through.
**Files:** `e2e/*.spec.ts`, deletion of legacy components.
**Success criteria:**
- `npm run test:e2e` passes (full suite).
- `npm run test:unit` passes.
- `npm run build` succeeds with no unused-export warnings related to deleted files.
- `git grep` shows no references to the deleted component names except inside this plan file.

## T10 — Cleanup pass
**Prerequisites:** T09.
**Scope:**
- Remove the back-compat fallback in `getActiveSubPlan` from T03 (now always read from `activeFloorPath`).
- Remove `activeSubPlanId` from `blockStore` if nothing else reads it.
- Run `npx tsc --noEmit` and fix any dead-code warnings.
- Verify there are no orphan files in `src/components/` outside `src/components/factory/` (other than `ItemPicker` and any other intentionally-shared primitive).
**Files:** `src/store/blockStore.ts` and any dead-code touch points.
**Success criteria:**
- `npm test` (unit + e2e) passes.
- `npx tsc --noEmit` is clean.
- `npm run build` is clean.
- Manual smoke test of the same flows as T08 still works.
