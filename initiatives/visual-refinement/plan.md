# Initiative: Visual refinement of the main screen

Status: Future

Eleven visual refinements of the production-table screen (summary strip, table, side panel, top bar), found by reviewing screenshots of the running app on a real, mid-game Seablock plan. The goal is to judge them in a design artifact first, mainly for their effect on **compactness**, before touching `src/components/`. Nothing is implemented, and the artifact does not exist yet: this document is the brief for the session that builds it.

Incomplete on purpose. These are first impressions from one plan, one data set and the dark theme; see [Not covered yet](#not-covered-yet).

---

## Why a design artifact

Most of these are trade-offs between density and legibility (a taller chip shows fewer columns; a collapsed summary strip frees rows but hides context). Reading a list does not show the effect, and implementing each one in React to compare is expensive. A design artifact that renders the current screen next to the proposed one, with a way to flip between them, lets the owner accept or reject each change by looking at it, and lets us put a number on the space gained.

## The reference plan

The owner's own save, `factorio-plan-middle-ring-2026-11-08.json` (Seablock, Factorio 2.0.77), about 30% of the way through the "middle ring" goal. It is a better stress test than the e2e fixtures, which are tiny. It has 11 blocks:

| Block | Shape seen on screen |
|---|---|
| Hub | 73 products, 26 ingredients, 223 recipes in two areas ("Top Row", "Bottom Row") |
| Metals | 22 products, 29 ingredients, 93 recipes, 21 area rows (Aluminium, Iron, Copper, …) |
| Ores | 13 products, 9 byproducts, 24 ingredients, 75 recipes, area rows mixed with plain recipe rows |
| Extra Sulfur | 18 plain recipe rows, 62 machines: the sparse-block baseline |
| Sciences, Circuits, Agricultural Science, Mod 1, Sludge, Bean 1, Clay Brick | smaller blocks |

The file is not in the repository (275 KB, personal). [capture-baseline.mjs](capture-baseline.mjs) works on any exported plan, and [../share-by-url/sample-plan-middle-ring.json](../share-by-url/sample-plan-middle-ring.json) is an earlier, smaller export of the same game that anyone can use. Ask the owner for the current save if the artifact needs real content beyond the screenshots. Check that a save matches the live plan before using it as a baseline: an earlier export of this plan (2026-11-07) held a stale Extra Sulfur block (goal 6000 sulfur/min, 13 recipes) that solved to 11 rows at zero and millions of items per minute, which the live plan did not show.

## The brief for the artifact session

Start with `Artifact` `action: "quickstart"` and `intent: "design"` (a visual design on a canvas), per the tool's instructions. Then:

1. **Rebuild the baseline faithfully.** Use the screenshots in [baseline/](baseline/) as the reference (re-capture with the script if the UI has changed). Keep the real Tailwind palette (gray-800/900 surfaces, teal accent, cyan power, green ingredient rates, red byproduct rates, amber warnings) and the real sizes under [Baseline measurements](#baseline-measurements).
2. **Make each finding a toggle**, so changes can be turned on one at a time and together. The ranking is a suggestion; the owner decides.
3. **Show the compactness effect.** A small readout that updates with the toggles: pixels above the table, pixels per row, rows visible at 900 px high, and whether Products, Byproducts and Ingredients are within one eye span. The point of the artifact is these numbers next to the pictures.
4. **Use the real content.** Rebuild at least one busy block (Metals: area rows with 6 to 13 chips each), one dense one (Hub: 73 products, rows that wrap to two lines) and one sparse one (Extra Sulfur), at 1440 px, plus 390 px and 1920 px views.
5. Record the owner's accept / reject / tweak decisions back in this document, then turn the accepted ones into backlog items or a follow-up plan.

## Findings

Ranked by expected impact on the screen. File pointers are where the current look lives. "Seen in" names the screenshots in [baseline/](baseline/).

### 1. The summary strip uses too much height, and still shows little

About 300 px of a 900 px viewport (a third) sits above the table's first row on a busy block (44 px top bar, then the strip from y=53 to y=293), and 272 px on a sparse one. At 390 px wide it is 36%.

- Much of it is empty or low-value. On Hub it shows 73 products in a grid capped at one row plus half of the next (`max-h-[97px]`, 8 slots per row at 1440 px), so 16 of 73 are visible and the rest need a scroll inside a small box. An empty Byproducts pane is a large box that says "Nothing here yet".
- The overview totals add unlike items: Hub's products read "Left 17.4 · 73", its ingredients "Imported 374". A rate that sums 73 different items does not tell the player anything, while the bars next to it are sized against such sums.
- The detail strip is a fixed `h-[110px]` so slots never move when the selection changes; that is deliberate (no layout shift), so a variant must keep selection from moving the table.

Ideas to compare: let a pane's height follow its content (an empty pane collapses to its header); a one-line summary mode that expands on click (overlaps the backlog item "Short viewports"); show the count and the top few items instead of a scrolling grid; stop summing unlike items in the overview.

Seen in: `hub.png`, `metals.png`, `ores.png`, `metals-390-phone.png`. Files: `FactorySummary.tsx`, `SummaryPane.tsx`, `SummaryDetailStrip.tsx`, `summarySegments.ts`.

### 2. The table spreads its columns apart on wide screens

Products and Byproducts sit on the left and Ingredients is pushed to the right edge, with Machine and Beacons empty in between on area rows. With the panel closed the gap between the last product chip and the first ingredient chip is about 290 px at 1440 (Ores) and roughly 700 to 900 px at 1920 (Metals), so the eye has to cross empty space to read what a row makes and what it consumes. The free width goes to Recipe, Byproducts and Ingredients in the proportions 3 : 2 : 4; with the side panel open the layout is fine, which is what the table was tuned for.

Ideas to compare: cap the table's width; give the free width to the Recipe column only; keep Ingredients adjacent to Byproducts and let the empty space fall to the right of Power.

Seen in: `metals-1920.png`, `ores.png`. Files: `ProductionTable.tsx` (`COLUMNS`, `TABLE_MIN_WIDTH`, `TOTAL_WEIGHT`).

### 3. Chips are hard to read: size, overflow and dark icons

- The quantity is 9px bold monospace in the bottom-right corner, over the icon. It is hard to read on red byproduct rates over red icons and green ingredient rates over green icons.
- Big and tiny numbers overflow the 28 px chip and collide with the next chip. Seen: `0.00000016` overlaps its neighbour in the ingredients of the Cobalt steel row (Metals), and `12361` and `20067` fill their chips edge to edge in Ores. Rates need a compact format ("12k", "<0.01") that always fits the chip.
- Dark item icons (carbon, rubber, coal-like items) have almost no contrast against the dark surface and read as holes. A chip background plate would fix this and the numbers at once.
- The 28 px item icon is small for how much the table relies on it.

Ideas to compare: a small dark pill behind the number; compact number formatting; a lighter chip background; a 32 px chip (cost: one fewer chip per line in Byproducts and Ingredients, see the 34 px chip slot in the spec).

Seen in: `metals.png`, `ores.png`. Files: `IconChip.tsx` (the `text-[9px]` quantity, `QUANTITY_COLOR`), `ItemChip.tsx`, the rate formatter used by the chips.

### 4. Secondary text and some controls have low contrast

Noticed: the "click a row to trace it" hint and the item counts in the overview; the ▲/▼ reorder arrows, which are nearly invisible although they are controls; the side-panel section labels (RATE, MACHINE, BEACONS); the `–` cells of the Effects table; the `+` new-block button; and the **All blocks ▾** overflow button at the right of the tab strip, which shows as a tiny dot (visible in `hub.png`, next to "Extr"). Check each against 4.5:1 (text) or 3:1 (controls) before choosing new greys.

### 5. Collapsed group rows are noisy and change height

- Every area row carries an "Area" tag, then "N recipes · N machines", and in Hub both numbers are the same ("114 recipes · 114 machines"). When every row of a table is an area, the tag adds nothing.
- Row height jumps from 33 px to 66 px (Hub, Metal Ores) when a group's chips wrap onto a second line, and a long list ends in a small dim "+30" / "+33" / "+6". The player cannot tell which items hide behind it.
- Group rows and recipe rows differ only by the tag; a subtle background band and a heavier name would make the tree readable at a glance.

Ideas to compare: drop the tag when all siblings are areas, or move it to an icon; show "114 recipes" only when it differs from the machine count; one fixed row height with the overflow in a popover; a band for group rows.

Seen in: `hub.png`, `ores.png`. Files: `RecipeRow.tsx` (sub-factory row), `AreaChipsMore.tsx`, `treeGuides.ts`.

### 6. Empty placeholders repeat on every recipe row

Every plain recipe row shows a dashed `+ 0/3` module chip and a dashed `+` beacon chip (`ores.png`, `extra-sulfur.png`). Over a long table this is noise. Idea: show them on row hover, on selection or on keyboard focus only. The cost is discoverability and touch (no hover), which the backlog's touch items already worry about, so a variant should keep them visible on touch.

Files: `MachineCell.tsx`, `ModuleCell.tsx`, `BeaconPopover.tsx` (`BeaconCell`).

### 7. The side panel is long, has dead space, and covers everything below `xl`

- For a recipe row, the Effects table is a grid of dashes while no module or beacon is set; hide or collapse it until there is something to show. "Where inputs come from" then moves up from the bottom edge of a 900 px screen.
- "Pin rate" is a native white checkbox on a dark panel. A styled switch would match.
- For an area the panel is good (summary, receives, sends, inside this group; see `metals-area-selected.png`), but its lists are long (Hub's Top Row receives 26 items) and take the full height.
- At 1024 px the panel becomes a drawer that covers more than half the screen and hides the selected row's columns, so the player cannot see what they are editing (`hub-1024-drawer.png`). Idea: a narrower drawer, or a bottom sheet on short and narrow screens.

Files: `src/components/factory/sidePanel/`, `FactoryShell.tsx`.

### 8. Row selection is subtle

A selected row has a 3 px teal bar on the left of the reorder cell and a faint tint. With dozens of rows and the panel open it is easy to lose which row the panel is about (`metals-area-selected.png`: Aluminium is selected, and you have to look for the bar). Ideas: a stronger tint, a teal outline, or a brighter name.

### 9. The block tabs overflow on a real plan and the top bar is unbalanced

- With 11 blocks at 1440 px the strip is cut at both ends: the first tab reads "nces" and the active tab "Extr" (`hub.png`). At 1920 px they fit. The cut-off tab names are what the user sees most of the time.
- An inactive tab's colour stripe is barely visible, and the tabs are small and low-contrast.
- The workspace button on the right carries more visual weight than the tabs. The block graph, areas and tech tree buttons are unlabeled icons that only a tooltip explains.

Ideas to compare: a smaller minimum tab width or two-line tabs; icon-only tabs for inactive blocks; a lighter workspace button; a text label on the view buttons at wide widths.

Files: `BlockTabs.tsx`, `TopBar.tsx`, `WorkspaceMenu.tsx`, `IconButton.tsx`.

### 10. Narrow screens: the toolbar wraps and the interesting columns are off-screen

At 390 px (`metals-390-phone.png`, and the Hub rows at 155 px high): the "+ Recipe" button wraps onto two lines and the counts and power break across lines; Machine and Beacons headers take about 170 px even on area rows, where they are empty, which pushes Products out of view; the summary strip takes 36% of the height. This overlaps the backlog's touch and "Sticky Recipe column" items, but those cover input and scrolling, not how the rows look. Ideas: on narrow screens, hide Machine and Beacons for group rows, stack the chips under the recipe name, and shorten the toolbar to the buttons that fit.

### 11. Keep the row density

Not a problem to fix: rows are about 33 px (37 px for plain recipe rows) with faint lines between them, and the real plan shows why that is right. At 1920 × 1080 the Metals block shows 22 rows at once (`metals-1920.png`); Hub and Metals have too many rows for anything taller to be comfortable. The artifact should treat row height as a budget to protect, and at most make the row separators or the group bands a little stronger. Any finding above that adds height (3, 5, 7) must show its cost per row.

## Baseline measurements

From the screenshots (1440 × 900 unless noted), dark theme, the reference plan. Re-measure after any layout change.

| What | Value |
|---|---|
| Top bar | 44 px |
| Summary panes (three, side by side) | about 240 px tall on a busy block (y=53 to 293), about 210 px on a sparse one |
| Region above the table toolbar | about 302 px busy (34%), 272 px sparse (30%); 36% at 390 px |
| Table toolbar | 44 px |
| Table header | about 26 px |
| Plain recipe row | about 37 px |
| Collapsed area row | 33 px, 66 px when its chips wrap |
| Rows visible below the toolbar | 15 (1440 × 900, Metals); 22 (1920 × 1080) |
| Item chip / machine chip | 28 px / 32 px icon, 9 px quantity text, 34 px chip slot |
| Summary slot grid | 8 slots per row at 1440 px, one row and a half visible |
| Side panel (open) | 380 px wide beside the table; a drawer over it below 1280 px |
| Gap from last product chip to first ingredient chip, panel closed | about 290 px (1440, Ores); 700 to 900 px (1920, Metals) |

## Reproducing the baseline

Screenshots in [baseline/](baseline/) (about 2.3 MB in all; trim them once the artifact exists):

| File | What it shows |
|---|---|
| `hub.png` | Hub at 1440 × 900: 73 products, two area rows with wrapped chips |
| `hub-area-selected.png` | Hub with "Top Row" selected, side panel open |
| `metals.png` | Metals at 1440 × 900: 21 area rows |
| `metals-area-selected.png` | Metals with "Aluminium" selected |
| `ores.png` | Ores: area rows and plain recipe rows mixed, 9 byproducts |
| `extra-sulfur.png` | Extra Sulfur: 18 plain recipe rows, dashed placeholders, a sparse summary strip |
| `metals-1920.png` | Metals at 1920 × 1080, the column gap |
| `hub-1024-drawer.png` | Hub at 1024 × 768 with the side panel as a drawer |
| `metals-390-phone.png` | Metals at 390 × 844 |

```sh
npm run dev -- --port 4173
node initiatives/visual-refinement/capture-baseline.mjs ~/Downloads/factorio-plan-middle-ring-2026-11-08.json /tmp/shots \
  --blocks "Hub,Metals,Ores,Extra Sulfur"
node initiatives/visual-refinement/capture-baseline.mjs <plan.json> /tmp/shots --blocks "Hub,Metals" --size 390x844 --suffix 390
```

[capture-baseline.mjs](capture-baseline.mjs) seeds the plan into `localStorage` under the data set named by its `dataSet` stamp (like `e2e/support/loadPlan.ts`), activates each named block's tab, and writes one screenshot of the block and one with its first recipe row selected. A name with no tab is reported and the active block is captured instead.

## Not covered yet

- A light theme, if one exists; only the dark one was looked at.
- The Nullius data set; the reference plan is Seablock.
- Modals and pickers (recipe picker, item picker, machine picker), the block graph, the areas matrix and the tech tree. With 11 blocks the block graph in particular is worth a look.
- The empty states ("No recipes yet", "Load game data to begin").
- Expanded sub-factories and deep nesting: the screenshots show collapsed areas only.
- Accessibility measurements: contrast ratios were judged by eye, not computed.
- The remaining blocks of the reference plan (Sciences, Circuits, Agricultural Science, Mod 1, Sludge, Bean 1, Clay Brick) were captured but not reviewed.

## After the artifact

Accepted findings become items in [../backlog.md](../backlog.md) under UI / UX, or one follow-up plan in this folder when several touch the same files (findings 1, 2 and 10 all change the vertical or horizontal budget, and 3 and 6 both change the chips and rows). When the changes ship, update [../../spec/ui.md](../../spec/ui.md) (the sizes it quotes) and move this folder to `initiatives/archive/`.
