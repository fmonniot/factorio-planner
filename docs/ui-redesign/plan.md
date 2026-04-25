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

---

## T11 — Primary product selection in RecipeRow
**Prerequisites:** T10 (done).

### Context
`updateNodePrimaryProduct(nodeId, itemId)` already exists in `blockStore`. `RecipeRow` already reads
`planNode.primaryProduct` to decide which output tile goes in the Products column vs the Byproducts
column. But there is no UI to *change* the primary product — the old `RecipeCard`'s `●/○` buttons
were deleted and never ported.

### Behaviour to implement
- **Single-output recipes**: no change — no primary-product UI needed.
- **Multi-output recipes**: each tile in the Products and Byproducts columns gets a thin visual
  indicator. The *current primary* tile shows a small `●` badge (or a bright ring). Every
  *non-primary* tile is clickable and calls `updateNodePrimaryProduct(nodeId, itemId)` on click.
  The click must also clear `planNode.byproductPolicy` for the newly-primary item (it should be fed
  back, not discarded, once it becomes primary).
- **No new popover required** — this is inline on the existing tiles, not a separate panel.

### Implementation detail
In `RecipeRow.tsx`:
- Determine `isMultiOutput = recipe.products.length > 1`.
- For each tile in both Products and Byproducts cells, if `isMultiOutput`:
  - If `itemId === primaryItemId`: render with a `●` badge (`title="Primary product"`).
  - Otherwise: render the tile with an `onClick` that calls `updateNodePrimaryProduct(nodeId, itemId)`,
    and `title="Set as primary"` so e2e tests can find it.

**Files:** `src/components/factory/RecipeRow.tsx` only (no new file needed).

### Success criteria
1. **Single-output**: rendering `RecipeRow` for a single-output recipe shows no `●` badge and no
   `title="Set as primary"` elements.
2. **Multi-output — primary indicator**: rendering a row with `brine-electrolysis` (3 outputs) shows
   exactly one `●` badge (`title="Primary product"`) and two tiles with `title="Set as primary"`.
3. **Multi-output — switch primary**: clicking `title="Set as primary"` on Sodium Hydroxide calls
   `updateNodePrimaryProduct` with the sodium hydroxide item id.
4. **E2e**: `e2e/primary-product-override.spec.ts` passes with the `test.skip` removed. Update the
   locators in that spec to match the new tile-based UI (the `●/○` inline buttons are replaced by
   tile titles; the card selector `.bg-gray-800` is replaced by a table row).
5. `npm run test:unit` passes (add unit tests covering criteria 1–3 in `RecipeRow.test.tsx`).

## T12 — Pin rate UI in RecipeRow
**Prerequisites:** T11.

### Context
`updateNodePinnedRate(nodeId, rate | undefined)` already exists in `blockStore` and is schema-backed.
`planNode.pinnedRate` (a `number | undefined`) and `solvedNode.throughput` are already available in
`RecipeRow`. There is no UI to pin or unpin — the old `RecipeCard`'s `📍/📌` toggle was deleted and
never ported.

### Behaviour to implement
- A **pin button** (`📍` unpinned / `📌` pinned) appears at the right edge of the Recipe name cell
  (visible on row hover, always visible when pinned).
- **Clicking 📍 (unpinned → pinned):**
  - Seed rate = `Math.max(solvedNode?.throughput ?? 0, 1)` items/min (prevents seed of 0).
  - Calls `updateNodePinnedRate(nodeId, seedRate)`.
- **Clicking 📌 (pinned → unpinned):**
  - Calls `updateNodePinnedRate(nodeId, undefined)`.
- **Pinned display**: the primary product `ItemTile` is replaced by a compact `<input type="number">`
  showing the pinned rate expressed in the current `rateUnit` (`/min` or `/sec`). The input has
  `aria-label="Pinned rate"`. On change, the value is converted back to items/min and passed to
  `updateNodePinnedRate`.
- **Unit conversion**: displayed value = `pinnedRate * (rateUnit === 'min' ? 60 : 1)`.
  Stored value on change = `parseFloat(input) / (rateUnit === 'min' ? 60 : 1)`.
- **Guard**: only parse and save if `isFinite(v) && v > 0`.

**Files:** `src/components/factory/RecipeRow.tsx` only.

### Success criteria
1. **Pin button unpinned**: a row with `pinnedRate === undefined` shows a `📍` button
   (`title="Pin rate"`).
2. **Pin button pinned**: a row with `pinnedRate = 2` shows a `📌` button (`title="Unpin rate"`)
   and the `<input aria-label="Pinned rate">` in the Products cell instead of the static tile.
3. **Clicking 📍**: calls `updateNodePinnedRate` with a value `> 0` even when `throughput === 0`.
4. **Clicking 📌**: calls `updateNodePinnedRate(nodeId, undefined)`.
5. **Typing in the pinned input**: changing the input to `120` (in `/min` mode) calls
   `updateNodePinnedRate` with `2` (120 / 60).
6. **E2e**: `e2e/pin-zero-throughput.spec.ts` is restored to the full interaction test (not just
   the data-layer check). Update locators: the old `.bg-gray-800` card becomes a `table tbody tr`,
   pin/unpin are `title="Pin rate"` / `title="Unpin rate"`, the pinned input is
   `aria-label="Pinned rate"`.
7. `npm run test:unit` passes (add unit tests covering criteria 1–5 in `RecipeRow.test.tsx`).

## T13 — Inline subplan table + remove sidebar
**Prerequisites:** T10.

This is a significant layout change requested after T10:

### Decisions
- **Remove** the enable ☐ checkbox column from `RecipeRow` — it never had a data backing and served no purpose.
- **Remove** `SubfactorySidebar` entirely.
- **Replace** the sidebar + floor drill-in model with a **single flat table** that shows all recipes across all subplan levels, using **indentation** to express nesting depth.
- **Add** a "wrap in subfactory" action on each recipe row (right-click or a row-level button) to group a recipe (and optionally its dependents) into a new child SubPlan.

### How the table should work

```
Depth 0 (root plan)
  Recipe A                     [machine] [beacon] [products] [byproducts] [ingredients] [power]
  ▶ Subplan: Iron Smelting     (collapsed — click ▶ to expand)
  ▼ Subplan: Oil Processing    (expanded)
      Recipe B                 [machine] …
      Recipe C                 [machine] …
  Recipe D                     [machine] …
[+ Add recipe]
```

- SubPlanNode rows render an expand/collapse toggle (▶/▼) instead of a drill-in button.
- Expanding a SubPlanNode inline-renders its child subplan's nodes, indented by one level.
- Indentation is expressed via `paddingLeft` on the row cells.
- The "wrap in subfactory" action creates a new child SubPlan, moves the target node into it, and inserts a SubPlanNode in its place.
- `uiStore.activeFloorPath`, `FloorBreadcrumb`, and `SubfactorySidebar` can all be removed once this is done.

### Files
- `src/components/factory/RecipeRow.tsx` — remove checkbox, add expand/collapse for SubPlanNode rows.
- `src/components/factory/ProductionTable.tsx` — recursive row rendering with depth tracking.
- `src/components/factory/SubfactorySidebar.tsx` — **delete**.
- `src/components/factory/FloorBreadcrumb.tsx` — **delete**.
- `src/components/factory/FactoryShell.tsx` — remove sidebar from layout.
- `src/store/uiStore.ts` — remove `activeFloorPath` and floor navigation actions; keep `rateUnit`.
- `src/store/blockStore.ts` — add `wrapNodeInSubPlan(nodeId, name)` action.

### Success criteria
- Production table shows all nested nodes in a single scrollable view, indented by depth.
- Expand/collapse toggles on SubPlanNode rows work correctly.
- Checkbox column is gone from all rows.
- Sidebar is gone; `FactoryShell` is a single two-zone layout (top: summary header, below: table + footer).
- `wrapNodeInSubPlan` creates a child SubPlan and inserts a SubPlanNode; existing tests for addSubPlan/removeSubPlan still pass.
- `npm run test:unit` passes.
- `npm run dev` manual smoke test: nested plan looks correct, expand/collapse works, wrapping a node works.

## T14 — Restore e2e tests for T13 changes
**Prerequisites:** T13.
**Scope:** Update any e2e specs that reference the sidebar or floor breadcrumb. Restore
`subplan-empty-state.spec.ts` with a new flow that matches the inline-expand model.
**Success criteria:** `npm run test:e2e` green (no skipped tests from sidebar/floor navigation).
