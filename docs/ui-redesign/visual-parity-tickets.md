# UI Redesign — Visual Parity Pass vs Factory Planner Target

## Context

The UI redesign in `docs/ui-redesign/plan.md` shipped through T01–T14. The result
([Screenshot 2026-04-26 at 04.24.05.png](Screenshot%202026-04-26%20at%2004.24.05.png))
captures the structural intent — flat subplan table, dense rows, three-section header,
inline expand/collapse — but is **visually thin** compared to the original Factory
Planner mod target
([Screenshot 2026-04-25 at 17.43.13.png](Screenshot%202026-04-25%20at%2017.43.13.png)).
Recipes show as text instead of icons, machine/beacon cells use verbose strings,
header boxes lack card chrome, and several ancillary elements (Factory section title,
balanced-items footer) are missing.

This document captures every visible difference between the two screenshots, separates
**deliberate divergences** (design decisions logged in plan.md) from **actionable gaps**,
and breaks the gaps into tickets sized for a single Sonnet 4.6 session.

The goal is: bring the shipped UI to visual parity with the target without reverting any
T13/T14 architectural decisions (no sidebar, no floor breadcrumb, inline-expand instead
of drill-in).

The output should be saved to `docs/ui-redesign/visual-parity-tickets.md` once the user
approves.

---

## Side-by-side comparison

### Top bar / window chrome
| Area | Target (17.43.13) | Current (04.24.05) | Status |
| --- | --- | --- | --- |
| App title | "Factory Planner" centred | "Factorio Planner" left-aligned | **Actionable** — drop the in-app title entirely; the browser tab title fills that role |
| Window-chrome icons (pin/play/resize/close) | Present (Factorio mod chrome) | Absent | Deliberate — out-of-scope per plan.md |
| Game-data picker | "Preferences" only | "Export plan" + "Nullius" dropdown | Deliberate — extra functionality we keep |
| BlockTabs | Not present (mod is single-block) | "Block 1 │ +" top-left, separate row | **Actionable** — align to same row as the game-data picker on the right |

### Left sidebar
| Area | Target | Current | Status |
| --- | --- | --- | --- |
| Sidebar pane | Present: District selector + subfactory list + search | Removed entirely | Deliberate (T13) |
| Subfactory toolbar (add/edit/dup/delete) | Present | Absent | Deliberate (T13) — wrap-in-subfactory replaces it |
| Search field | Present at sidebar bottom | Absent | Deliberate (T13) |

### Header (Products / Byproducts / Ingredients summary)
| Area | Target | Current | Status |
| --- | --- | --- | --- |
| "Factory" section title above the three boxes | Present | Absent | **Actionable** — and make it the editable block name (default value: "Factory") |
| Three boxes have visible card chrome (border + background panel) | Yes | Flat, no panel chrome | **Actionable** |
| Section labels ("Products", "Byproducts", "Ingredients") | Title case, with section-icon | All-caps text label | Minor — visual only |
| `[+]` button to add a goal in the Products box | Present | Hard to spot / placed on wrong control | **Actionable** — verify discoverability |
| `/sec ⇄ /min` toggle | Top-right of summary | Top-right of summary | Match |
| `Items/s` ⇄ `Items/s/m` toggle | Present | Absent | Deliberate — out-of-scope per plan.md |

### Production table — header row
| Area | Target | Current | Status |
| --- | --- | --- | --- |
| `⚙ Production` heading | Present (mod-side controls glyph) | "Production" plain text | Deliberate — the gear in the target is a Factorio-mod control we don't need; remove the `Production` heading too if it adds nothing |
| Floor breadcrumb (`Level 1 ↑ ⤒`) | Present | Absent | Deliberate (T13) |
| `Solver: Traditional / Matrix` toggle | Present, far right | Absent | Deliberate — out-of-scope |
| Column titles: `Recipe Machine Beacon Products Byproducts Ingredients` | Present | Present, plus extra `Power` column | **Actionable** — power should be inline as electricity tile |

### Production table — recipe rows
| Area | Target | Current | Status |
| --- | --- | --- | --- |
| Recipe column shows recipe **icon** | Yes — small recipe sprite | Recipe **name** as text (`Propene pyrolysis`) | **Actionable — biggest visual gap** |
| Reorder ↕ controls at row start | Always-visible up/down chevrons | Already always-visible (`text-gray-600`, hover→`text-gray-300`) | Match — current behaviour is correct, no work |
| Enable ☐ checkbox | Present | Removed | Deliberate (T13) |
| Machine cell: count + machine icon + module-slot dots | Compact: `1 [icon] [▢▢▢]` | Verbose text: `1 Distillery 3 (0/3)` | **Actionable** |
| Beacon cell: `[+]` button or compact icon summary | Icon-style add control | Text link `+beacon` | **Actionable** |
| Item tiles (products/byproducts/ingredients) | Strong card chrome with coloured tinted background | Tinted, but flatter / less prominent | Minor — visual only |
| Electricity column | Inline as last item-tile (lightning bolt) in ingredients, no dedicated column | Dedicated `Power` column with text | **Actionable** |
| Pin (📌/📍) and wrap (⊞) buttons | Not in target | Hover-revealed buttons next to recipe name | **Actionable** — relocate to the **left of the recipe icon** (row-start gutter) so they don't crowd the icon column |
| Row hover affordance | Dark band per row | Subtle hover bg | Match |

### Footer
| Area | Target | Current | Status |
| --- | --- | --- | --- |
| `Unrestricted items balanced` strip with diagnostic tiles | Present | Absent (BalancedItemsFooter exists in code but appears not rendered or empty) | **Actionable** — verify, and **merge the warning indicator into it** so the bottom strip is one cohesive status bar |
| `[+ Add recipe]` row | Present at bottom of table | Present at bottom-left of footer area | Match |
| Warnings indicator | "1 warning" text bottom-right | "1 warning ⚠" bottom-right | **Actionable** — fold into BalancedItemsFooter (see V08) |

---

## Deliberate divergences (no work)

These were explicit decisions in `docs/ui-redesign/plan.md` and the T13/T14 follow-up.
Listed here for completeness so future readers don't file tickets against them:

- No left sidebar; no district selector; no subfactory toolbar; no sidebar search.
- No floor breadcrumb (`Level N ↑ ⤒`); nesting is expressed by inline indented expand/collapse.
- No enable ☐ checkbox column.
- No `Items/s ⇄ Items/s/machine` toggle.
- No `Solver: Traditional ⇄ Matrix` toggle.
- BlockTabs in top-left corner (target has no equivalent).
- Window-chrome icons (pin/play/resize/close) — target shows Factorio mod chrome only.

---

## Tickets

Each ticket is sized for a single session: read context → implement → verify. Tickets are
independent unless a `Prerequisites` line says otherwise. Recommended order is roughly
top-to-bottom because high-impact visual gaps (recipe icon, machine cell) deliver the
biggest perceived improvement first.

### V01 — Recipe column shows recipe icon, not name; pin/wrap move left of icon
**Prerequisites:** none.
**Why:** The most visible gap. Target rows show a recipe sprite; we render `recipe.name`
text, which makes rows feel like a spreadsheet rather than a dense game UI. While we're
in this cell, also move the pin (📌/📍) and wrap (⊞) buttons to the **left** of the
recipe icon — putting them after the icon crowds the icon column and competes with the
icon for attention.
**Scope:** In [src/components/factory/RecipeRow.tsx](src/components/factory/RecipeRow.tsx#L117-L148):
- Replace `<span>{recipe.name}</span>` with a recipe icon resolved via the existing
  icon resolver (the same one used by `ItemTile` — find it and reuse, do not duplicate).
- Keep the recipe name in the `title` attribute so it shows on hover.
- Reorder the cell content to: `[pin button] [wrap button] [recipe icon]`. Pin/wrap
  remain hover-revealed (current behaviour) until pinned, then the pin stays visible.
- For SubPlanNode rows, keep the existing `▶/▼` + name layout; only `RecipeNode` rows change.
**Files:** `src/components/factory/RecipeRow.tsx`, possibly `src/components/factory/ItemTile.tsx`
if the icon resolver lives there and needs to be exported.
**Success criteria:**
- Recipe column renders an `<img>` (or icon component) sized ~24–28 px square.
- The recipe name no longer appears as visible text in the row; it is on `title`.
- Pin and wrap buttons render before the recipe icon in DOM order.
- `RecipeRow.test.tsx` updated: assertions on `getByText(recipe.name)` replaced with
  `getByTitle(recipe.name)` or icon `alt`.
- `npm run test:unit` passes; `npm run test:e2e` passes (update locators in any spec
  that searched by recipe-name text).

### V02 — Machine cell: icon + count + module-slot dots
**Prerequisites:** none.
**Why:** Current cell `1 Distillery 3 (0/3)` is a wall of text. Target is iconic and
parseable in 200 ms.
**Scope:** In `src/components/factory/MachinePopover.tsx` (the `MachineCell` export) and
`src/components/factory/ModulePopover.tsx` (the `ModuleCell` export):
- `MachineCell` should render: machine count (small tabular-num), then machine icon,
  then a thin module-slot strip (one filled/empty square per slot, e.g. ▢▣▢).
- The full `Distillery 3 (0/3)` string should remain in `title` for hover tooltips.
- The popover trigger area must remain clickable everywhere it currently is.
**Files:** `src/components/factory/MachinePopover.tsx`, `src/components/factory/ModulePopover.tsx`,
unit tests for both.
**Success criteria:**
- Machine cell shows: count digit, machine icon (~22 px), module-slot indicator.
- No machine name text visible by default; available via `title`.
- Module slots are visually distinct (filled vs empty); clicking opens the existing popover.
- Existing tests updated; `npm run test:unit` passes.

### V03 — Beacon cell: icon-style add button instead of "+beacon" text
**Prerequisites:** none.
**Why:** Match target where the empty beacon cell is a small `[+]` button, not a text link.
**Scope:** In `src/components/factory/BeaconPopover.tsx` (`BeaconCell`):
- When `beacon` is undefined, render a small `[+]` button (icon-button styling, square,
  ~22 px) instead of the text "+beacon".
- When a beacon is configured, render an icon + count summary (icon, "×N", module dots),
  not a text label.
- Keep `aria-label`/`title` for accessibility and e2e test stability.
**Files:** `src/components/factory/BeaconPopover.tsx`, its unit test.
**Success criteria:**
- Empty beacon cell shows a square `+` button without the word "beacon".
- Configured beacon cell shows beacon icon + count without the beacon name.
- Click still opens the existing beacon popover.
- `npm run test:unit` passes; e2e specs still locate the cell.

### V04 — Power becomes inline electricity tile in Ingredients column
**Prerequisites:** none (independent layout change).
**Why:** Target has no dedicated Power column. Electricity is a tile alongside ingredients
on the right side of the row.
**Scope:** In `src/components/factory/RecipeRow.tsx` and `src/components/factory/ProductionTable.tsx`:
- Remove the `Power` column from the `<thead>` and the trailing `<td>` from `RecipeRow`.
- Append the electricity `ItemTile` (variant=`'electricity'`) at the end of the
  Ingredients cell's tile list, only when `powerKw > 0`.
- The colspan on the SubPlanNode row (`colSpan={8}` at line 55) must shrink to `7`.
**Files:** `src/components/factory/RecipeRow.tsx`, `src/components/factory/ProductionTable.tsx`,
their tests.
**Success criteria:**
- Table header shows 6 data columns (no Power).
- Electricity tile appears as the right-most tile inside the Ingredients cell.
- Subplan row continues to span the full width.
- `npm run test:unit` passes; e2e: any spec asserting "Power" column removed.

### V05 — Editable block name as section title; add card chrome to summary boxes
**Prerequisites:** none.
**Why:** The three summary boxes float without a visual container. Target shows a
labelled section above them. Rather than a static "Factory" label, expose this as the
**editable block name**: clicking the heading lets the user rename the block. The default
name on a new block is `"Factory"`.
**Scope:** In `src/components/factory/FactorySummary.tsx`:
- Render an inline-editable block name above the three boxes. Click → switch to a text
  input prefilled with the current block name; blur or Enter commits the change via the
  existing block-rename action in `blockStore` (or add one if missing).
- New blocks should default to `"Factory"` — update the block-creation path in
  `blockStore.ts` if needed.
- Wrap each of the three boxes (Products / Byproducts / Ingredients) in a bordered panel
  (`border border-gray-700 rounded bg-gray-900/40`-style — match Tailwind tokens already
  in use elsewhere in the file).
- Keep the `[+]` add-goal button inside the Products panel; ensure it's visually distinct
  enough that users discover it.
**Files:** `src/components/factory/FactorySummary.tsx` and its test;
`src/store/blockStore.ts` if a rename action or default-name change is needed.
**Success criteria:**
- The block name renders above the summary boxes; clicking it switches to an input.
- Editing the name and pressing Enter (or blurring) updates `block.name` in the store.
- New blocks have name `"Factory"` by default.
- Each of the three summary boxes has a bordered container.
- The `[+]` button in the Products box adds a goal on click.
- `npm run test:unit` passes; existing BlockTabs tests still pass (since they read the
  same `block.name`).

### V06 — Drop the "Production" table heading
**Prerequisites:** none.
**Why:** The `⚙ Production` heading in the target is a Factorio-mod control surface
(gear opens mod settings). On the web we have no equivalent action, and the heading
itself adds no value over the column header row directly below.
**Scope:** In `src/components/factory/ProductionTable.tsx`, remove the `Production`
heading row entirely. The column-titles row (Recipe, Machine, Beacon, …) stays.
**Files:** `src/components/factory/ProductionTable.tsx`, its test.
**Success criteria:**
- No `Production` heading text in the rendered output.
- Column header row still renders as the first row of the table.
- `npm run test:unit` passes; e2e specs that searched for `Production` text updated.

### V07 — BlockTabs share a row with the game-data picker (drop in-app title)
**Prerequisites:** none.
**Why:** Two changes to the top bar that are most cleanly done together:
1. Drop the in-app `Factorio Planner` / `Factory Planner` title — the browser tab
   title fills that role on the web, so the in-app text is wasted vertical space.
2. With the title gone, BlockTabs can move up to the same row as the game-data picker
   and Preferences button on the right, giving a single compact top bar.
**Scope:** In `src/components/factory/TopBar.tsx`:
- Remove the title element (`<h1>` or equivalent).
- Lay out the top bar as a single row: `[BlockTabs ……………… GameDataSelector | Preferences]`.
- Update `index.html` `<title>` if it currently says "Factorio Planner" — set it to
  "Factory Planner" so the browser tab matches the project branding.
**Files:** `src/components/factory/TopBar.tsx`, its test, `index.html`.
**Success criteria:**
- The top bar is a single row: tabs on the left, game-data + preferences on the right,
  no title text in between.
- Browser tab shows "Factory Planner".
- `npm run test:unit` passes.

### V08 — Merge BalancedItemsFooter and warning indicator into one status strip
**Prerequisites:** none.
**Why:** Target has an `Unrestricted items balanced` strip at the bottom. We have two
separate elements (`BalancedItemsFooter` — possibly empty/unwired — and a `1 warning`
indicator at bottom-right). Merge them so the bottom of the page is a single status bar.
**Scope:**
- Confirm `BalancedItemsFooter` is mounted inside `FactoryShell` after `ProductionTable`.
  If unwired or empty, debug the data source (solver result key) and fix.
- Move the warning indicator (currently bottom-right of the page; locate it — likely in
  `FactoryShell.tsx` or a sibling) **into** `BalancedItemsFooter`. The footer becomes:
  `[Unrestricted items balanced]  [tile][tile]…       [⚠ N warnings]` — heading and
  tiles on the left, warning summary on the right of the same strip.
- Clicking the warning summary should still open the warnings popover (preserve the
  existing `WarningsPopover` integration).
**Files:** `src/components/factory/BalancedItemsFooter.tsx`,
`src/components/factory/FactoryShell.tsx`, possibly
`src/components/factory/WarningsPopover.tsx` if its trigger lives there today.
**Success criteria:**
- The bottom of the page is a single horizontal strip with both balanced items and the
  warning summary.
- No standalone warning indicator remains elsewhere.
- Clicking the warning text opens the existing warnings popover.
- `npm run test:unit` passes; e2e: update any spec that targeted the old standalone
  warning indicator.

### V10 — Recipe / item picker redesign — **Shipped (T15)**
**Status:** Done. The flat fuzzy-search list shipped in T06 has been replaced by
two-level Factorio-style pickers. See `plan.md` T15 for the full record. Stable
selectors exposed for future test work:
- Recipe picker: `recipe-group-tab`, `recipe-subgroup-row`, `recipe-slot`,
  `recipe-detail-panel`.
- Item picker: `item-group-tab`, `item-subgroup-row`, `item-slot`.

### V09 — Polish: tile chrome and table density
**Prerequisites:** V01 (because tile presentation is more visible once recipe icons land).
**Why:** Final pass for visual fidelity. Target tiles have a stronger card feel
(coloured top-edge bar, slight inner padding); rows feel tighter overall.
**Scope:** Pure CSS (Tailwind). Touch only:
- `src/components/factory/ItemTile.tsx`: add a coloured top or left edge for variant
  (`product`=teal, `byproduct`=red, `ingredient`=green, `electricity`=yellow).
- `src/components/factory/RecipeRow.tsx`: tighten vertical padding (`py-1` → `py-0.5`)
  if rows feel airy compared to target; verify against screenshot.
**Files:** as above.
**Success criteria:**
- Variants are distinguishable at a glance via a coloured edge, not only background tint.
- Row height is similar to target (~28–32 px).
- No functional regressions; tests pass.

---

## Suggested execution order

1. **V01** (recipe icon + pin/wrap relocation) — biggest visual win, unblocks V09 polish.
2. **V02 + V03** (machine + beacon cells) — same row, same review pass.
3. **V04** (power → inline tile) — small, removes a column.
4. **V05** (editable block name + summary card chrome).
5. **V06** (drop Production heading) + **V07** (single-row top bar, drop in-app title).
6. **V08** (merge balanced-items footer with warning indicator).
7. **V09** (tile chrome + density) — final pass once everything else is in place.
8. **V10** — already shipped via T15 (recipe / item picker redesign).

Each ticket should ship as its own PR; running the dev server after each one and
comparing against the target screenshot is the verification loop.

## Verification

After all tickets land, the verification is a side-by-side screenshot diff against
[Screenshot 2026-04-25 at 17.43.13.png](Screenshot%202026-04-25%20at%2017.43.13.png),
ignoring the deliberate-divergence list above. The two should be visually convergent
modulo:

- Left sidebar absence (T13).
- Floor breadcrumb absence (T13).
- BlockTabs presence (T08).
- Items/s and Solver mode toggles absence (out of scope).
