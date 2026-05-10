# Initiative: Drag-and-drop reordering of recipes and subgroups

Status: Active

---

## Context

Today the only way to reorder recipes inside a block is the up/down arrow buttons in [RecipeRow.tsx](../../src/components/factory/RecipeRow.tsx) (`ReorderCell`). They swap adjacent siblings inside the *same* `SubPlan.nodes[]`, so:

- A recipe in the main plan cannot be moved into a subgroup (or vice versa) without removing and re-adding it (and losing its module/beacon configuration).
- Reordering across subgroup boundaries is impossible.
- Long node lists are slow to rearrange one swap at a time.

The repo's [TODO.md](../../TODO.md) calls this out under **Subgroup improvements**:

> It should be possible to move recipes between the main group and a sub group, or between sub groups. Drag'n'drop sounds like a good way to do that.

The intended outcome is that the user can grab any row — recipe or subgroup — and drop it anywhere in the recipe list, including into or out of subgroups, and the change participates in undo/redo like every other mutation.

---

## Decisions

- **Drag scope**: both recipe rows *and* subgroup rows are draggable. Dragging a subgroup moves it as a whole (its nested `SubPlan` comes along).
- **Drop on a collapsed subgroup row** = append-into-subgroup (the dragged node becomes the last child of that subgroup's `nodes[]`).
- **Up/down arrows stay** as a keyboard-friendly fallback. Drag-and-drop is purely additive.
- **No new library**. HTML5 native DnD (`draggable` + `onDragStart`/`onDragOver`/`onDrop`) is sufficient for this desktop app and avoids a dependency.

---

## Approach

### 1. New store action: `moveNode(nodeId, targetSubPlanId, targetIndex)`

In [blockStore.ts](../../src/store/blockStore.ts), add a single command-pattern action that handles both same-subplan reorder and cross-subplan moves. It supersedes — but does not delete — `moveNodeUp` / `moveNodeDown`.

Behaviour:

- Resolve the **source** `(sourceSubPlanId, sourceIndex)` via the existing `findSubPlanContainingNode` helper.
- **No-op guard**: if `sourceSubPlanId === targetSubPlanId` and the resulting position equals the current one, skip pushing to history.
- **Cycle guard** (subgroup case only): if the dragged node is a `SubPlanNode`, refuse the move when `targetSubPlanId` equals its `subPlanId` or is a descendant of it. Add a small helper `isSubPlanDescendant(rootPlan, ancestorId, candidateId)` next to the existing tree helpers.
- **Index normalisation** for same-subplan moves: when removing source first, decrement `targetIndex` if `sourceIndex < targetIndex`. Compute and capture the *normalised* `targetIndex` inside the command closure so apply/undo are exact inverses.
- The `Command` captures source-subplan/index, target-subplan/index, and the node payload, then:
  - `apply`: remove the node from `sourceSubPlanId.nodes` at `sourceIndex`; insert it into `targetSubPlanId.nodes` at the normalised `targetIndex`. Touch both subplans via the existing `touchSubPlan` helper.
  - `undo`: the exact inverse, splicing the node back at `sourceIndex` of `sourceSubPlanId`.

Wire `moveNode` into the `BlockStoreState` interface alongside the existing move actions.

### 2. Lightweight DnD context

New file `src/components/factory/RecipeDnd.tsx` exporting:

- `<RecipeDndProvider>` — wraps the table body and holds the in-flight drag state (`{ nodeId, kind: 'game-recipe' | 'subplan', sourceSubPlanId }`) in a React context. Used so drop targets can validate cycles synchronously during `onDragOver`.
- `useRecipeDnd()` — returns `{ dragging, beginDrag, endDrag }` for callers.

Why a context (vs. `dataTransfer` only): `dataTransfer.getData` is unavailable during `dragover` in Chromium, so highlighting the *valid* drop zones requires us to remember what we are dragging in component state.

### 3. Row-level drag/drop in `RecipeRow.tsx`

Extend [RecipeRow](../../src/components/factory/RecipeRow.tsx) with:

- A small **drag-handle button** added to the existing `ReorderCell` (or a tiny new cell to its left). It uses a grip glyph and an `onMouseDown` that flips a `draggable` flag on the `<tr>` for the duration of the drag — the standard "handle-only drag" pattern. The rest of the row stays non-draggable so popovers/buttons keep working.
- `onDragStart`: call `beginDrag(...)`, set `dataTransfer.effectAllowed = 'move'`.
- `onDragOver`: compute the drop "zone" from the cursor's Y position relative to the `<tr>`'s bounding rect:
  - **Recipe row**: top half → *before*, bottom half → *after*.
  - **SubPlan row, collapsed**: any zone → *append-into-subgroup*.
  - **SubPlan row, expanded**: top half → *before* (sibling), bottom half → *first child of subgroup*.
  - Set `dataTransfer.dropEffect = 'move'` only when the drop is valid (cycle check).
- Render an **insertion indicator**: a 2-px coloured line absolutely positioned above or below the row when it is the active drop target. For *append-into-subgroup* the whole subgroup row gets a coloured outline instead.
- `onDrop`: call `moveNode(draggedId, targetSubPlanId, targetIndex)` with the resolved tuple, then `endDrag()`.

Each row needs to know `parentSubPlanId` and its `index` within that subplan to compute drop targets — `ProductionTable.renderNodes` already has both at iteration time (see step 4), so we pass them down as new `RecipeRow` props.

The handle, indicators, and `onDrag*` handlers are added to **both branches** of `RecipeRow` (the `subplan`-kind branch and the `game-recipe` branch), so subgroups are draggable too.

### 4. Wiring in `ProductionTable.tsx`

Adjustments to [ProductionTable](../../src/components/factory/ProductionTable.tsx):

- Wrap the `<tbody>` (and the empty-state add-recipe affordance) in `<RecipeDndProvider>`.
- In `renderNodes`, pass `parentSubPlanId` (the SubPlan currently being iterated) and the per-iteration `idx` to each `RecipeRow` so it knows its own `(subPlanId, index)`.
- **Empty expanded subgroup** (currently renders no children rows at all): emit a single placeholder row whose only role is to be a drop target with `targetIndex = 0` for that subplan. Without this, an empty subgroup is impossible to drop into via DnD. Indent it like a child row so it visually belongs to the parent subgroup.
- **Trailing drop zone**: a final empty row at the very bottom of the main plan acts as "append to root". Implementation-wise this can be the existing "+ Add recipe" footer area extended to act as a drop target.

### 5. Tests

**Unit tests** in [blockStore.test.ts](../../src/store/blockStore.test.ts):

- `moveNode`: same-subplan reorder forward and backward (verifies index normalisation).
- `moveNode`: recipe from main plan into a subgroup; verify both subplans' `nodes[]`.
- `moveNode`: recipe from one subgroup back to the main plan.
- `moveNode`: undo/redo round-trip restores prior order exactly.
- `moveNode`: cycle guard — moving a `SubPlanNode` into its own subplan (and into a descendant) is a no-op and does not push to history.
- `moveNode`: trivial no-op (same source and target index) does not push to history.

**E2E test** new `e2e/recipe-drag-and-drop.spec.ts`, modelled after the existing specs in [e2e/](../../e2e/) (e.g. [nodes-panel.spec.ts](../../e2e/nodes-panel.spec.ts)). Playwright supports drag/drop via either `page.dragAndDrop(sourceSelector, targetSelector)` or `Locator.dragTo(target, { sourcePosition, targetPosition })`; the latter lets us pin the cursor to the top vs. bottom half of the target row, which is what differentiates "insert before" from "insert after". For the cases where `dragTo` doesn't trigger the HTML5 events reliably under headless Chromium (a known Playwright caveat for native DnD), fall back to dispatching `dragstart` / `dragover` / `drop` events manually on the locators.

Scenarios to cover:

- Reorder two recipes within the main plan via drag — assert the row order in the DOM, then trigger undo and assert the previous order is restored.
- Drag a recipe from the main plan onto a *collapsed* subgroup row — assert the subgroup's recipe count badge increments and the source row no longer appears at the top level.
- Expand the subgroup, drag the recipe back to the main plan above an existing row — assert it lands above the expected row.
- Drag a subgroup row to a new position in the main plan — assert the subgroup row plus its (still expanded) children move together.
- Attempt to drag a subgroup onto its own (expanded) child rows — assert no DOM reordering occurs.

Use a small fixture set up via the existing block-store seeding pattern these specs already use.

---

## Critical files

- [src/store/blockStore.ts](../../src/store/blockStore.ts) — add `moveNode` action + `isSubPlanDescendant` helper.
- [src/components/factory/RecipeRow.tsx](../../src/components/factory/RecipeRow.tsx) — drag handle, drag/drop handlers, insertion indicator on both row branches.
- [src/components/factory/ProductionTable.tsx](../../src/components/factory/ProductionTable.tsx) — context provider, propagate `(parentSubPlanId, index)`, empty-subgroup placeholder, trailing drop zone.
- **New** `src/components/factory/RecipeDnd.tsx` — `RecipeDndProvider` + `useRecipeDnd` hook.
- [src/store/blockStore.test.ts](../../src/store/blockStore.test.ts) — new `moveNode` tests.
- **New** `e2e/recipe-drag-and-drop.spec.ts` — Playwright DnD coverage.

---

## Reused existing utilities

- `findSubPlanContainingNode`, `findSubPlan`, `updateSubPlanInTree`, `touchSubPlan` in [blockStore.ts](../../src/store/blockStore.ts) — for command apply/undo.
- `applyCommand` — undo/redo plumbing.
- The recursive `renderNodes` in [ProductionTable.tsx](../../src/components/factory/ProductionTable.tsx) — extended in place rather than rewritten.
- `ReorderCell` in [RecipeRow.tsx](../../src/components/factory/RecipeRow.tsx) — extended with the drag handle, not replaced.
- The existing [Icon](../../src/components/Icon.tsx) component for the grip glyph (or a Tailwind-styled span if no suitable icon exists).

---

## Out of scope

- Multi-select drag.
- Touch / mobile drag UX (this app is desktop-oriented).
- Keyboard-driven cross-subplan move (still possible by chaining up/down arrows + a future "promote/demote" action — not required now).
- Drag-to-reorder *between blocks* (block tabs).

---

## Verification

1. `npm run test:unit` — new `moveNode` cases pass; existing block-store and persistence tests still pass.
2. `npm run test:e2e` — the new `e2e/recipe-drag-and-drop.spec.ts` passes alongside the existing suite.
3. `npm run lint` — clean.
4. `npm run build` — typecheck + Vite build clean.
