# Initiative: Visual refinement of the main screen

Status: Active

Eleven visual refinements of the production-table screen (summary strip, table, side panel, top bar), found by reviewing screenshots of the running app on a real, mid-game Seablock plan. The goal is to judge them in a design artifact first, mainly for their effect on **compactness**, before touching `src/components/`. Nothing is implemented in `src/components/`. The artifact exists and is waiting for the owner's feedback: this document is the brief, and [HANDOFF.md](HANDOFF.md) holds the state of the work (what is built, how to restart, next steps).

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
4. **Use the real content.** Rebuild at least one busy block (Metals: area rows with 6 to 13 chips each), one dense one (Hub: 73 products, rows that wrap to two lines) and one sparse one (Extra Sulfur), at 1440 px, plus the owner's devices: Galaxy Z Fold8 (cover 416 × 657 and inner 816 × 616, as measured; it is the owner's phone, so no separate 390 px view), iPad A16 (portrait and landscape), and a 1920 px view.
5. Record the owner's accept / reject / tweak decisions back in this document, then turn the accepted ones into backlog items or a follow-up plan.

## Findings

Ranked by expected impact on the screen. File pointers are where the current look lives. "Seen in" names the screenshots in [baseline/](baseline/).

### 1. The summary strip uses too much height, and still shows little

About 300 px of a 900 px viewport (a third) sits above the table's first row on a busy block (44 px top bar, then the strip from y=53 to y=293), and 272 px on a sparse one. At 390 px wide it is 36%.

- Much of it is empty or low-value. On Hub it shows 73 products in a grid capped at one row plus half of the next (`max-h-[97px]`, 8 slots per row at 1440 px), so 16 of 73 are visible and the rest need a scroll inside a small box. An empty Byproducts pane is a large box that says "Nothing here yet".
- The overview totals add unlike items: Hub's products read "Left 17.4 · 73", its ingredients "Imported 374". A rate that sums 73 different items does not tell the player anything, while the bars next to it are sized against such sums.
- The detail strip is a fixed `h-[110px]` so slots never move when the selection changes; that is deliberate (no layout shift), so a variant must keep selection from moving the table.

Ideas to compare: let a pane's height follow its content (an empty pane collapses to its header); a one-line summary mode that expands on click (overlaps the backlog item "Short viewports"); show the count and the top few items instead of a scrolling grid; stop summing unlike items in the overview.

*Owner's review (2026-11-08):* the grid already scrolls inside its box (`max-h-[97px] overflow-y-auto`), so every slot is reachable and clickable; "16 of 73 are visible" means 16 without scrolling. The one-line summary should be a persistent collapse/expand toggle rather than an overlay opened by "Show all": connection work happens in batches, and an overlay needs a click every time (the replica's `sumLine`). Rejected: "Counts instead of sums" (the item count is key information in the strip) and "Height follows content" (the `+N` tile made hidden items harder to click than scrolling does; once the scroll was kept, the height barely changed on any block, since the strip is as tall as its fullest pane).

*Decision (2026-11-08, after trying every toggle of the replica):* **accepted:** `sumShort` (colour key and actions on one line, 72 px detail strip), `legTip` (black tooltip on a bar segment), `legInBar` (16 px bar with the name and amount inside by segment width), `ovBar` (overview rows as one stacked bar sized by share), `sumLine` (persistent collapse/expand one-line summary) and `sumStack` (phones stack the three collapsed panes). **Rejected:** `legMenu` (36 px two-line bar with the actions as icon buttons in the item header). Settled for the implementation: `legTip` and `legInBar` are combined. The text inside the bar (name and amount, amount alone, or nothing, by segment width) is the directly visible information and is dropped when a segment is too short; the black tooltip on hover or focus always carries the full information (name, amount, key line) but is less directly accessible. The collapsed state of `sumLine` survives a reload, like other UI state (the replica does not store it across reloads).

Seen in: `hub.png`, `metals.png`, `ores.png`, `metals-390-phone.png`. Files: `FactorySummary.tsx`, `SummaryPane.tsx`, `SummaryDetailStrip.tsx`, `summarySegments.ts`.

### 2. The table spreads its columns apart on wide screens

Products and Byproducts sit on the left and Ingredients is pushed to the right edge, with Machine and Beacons empty in between on area rows. With the panel closed the gap between the last product chip and the first ingredient chip is about 290 px at 1440 (Ores) and roughly 700 to 900 px at 1920 (Metals), so the eye has to cross empty space to read what a row makes and what it consumes. The free width goes to Recipe, Byproducts and Ingredients in the proportions 3 : 2 : 4; with the side panel open the layout is fine, which is what the table was tuned for.

Ideas to compare: cap the table's width; give the free width to the Recipe column only; keep Ingredients adjacent to Byproducts and let the empty space fall to the right of Power.

*Decision (2026-11-08, after trying the three toggles):* **rejected, all of them:** `colRecipe` (extra width to Recipe), `colTrail` (chip columns stay together, spare width at the right) and `colCap` (cap the table at 1160 px). None was interesting enough to keep, so the toggles are removed from the replica and the finding stays open: the gap between the last product chip and the first ingredient chip is still measured (the "Products to ingredients" readout) but nothing is proposed for it. Reasons not recorded. The owner then suggested a smaller change, `ingLeft`: left-align the ingredient chips in their column instead of right-aligning them (nothing else moves; Power stays at the right). Measured in the replica at 1920 × 1080, panel closed: gap from last product chip to first ingredient chip 624 to 237 px on Ores and 846 to 365 px on Metals. What stays is the empty Byproducts column and the Recipe column's share; the empty space moves to between Ingredients and Power. *Settled (2026-11-08):* **accepted:** `ingLeft`. Two details settled with it: area and recipe rows start their first ingredient at the same x (area rows borrow 28 px from the Products span for the `+N`, so recipe rows get the same 28 px of left padding and hold one chip fewer per line), and the "Ingredients" header is left-aligned over the chips. Power keeps its right-aligned column. What remains of the gap is the empty Byproducts column; nothing is proposed for it.

Seen in: `metals-1920.png`, `ores.png`. Files: `ProductionTable.tsx` (`COLUMNS`, `TABLE_MIN_WIDTH`, `TOTAL_WEIGHT`).

### 3. Chips are hard to read: size, overflow and dark icons

- The quantity is 9px bold monospace in the bottom-right corner, over the icon. It is hard to read on red byproduct rates over red icons and green ingredient rates over green icons.
- Big and tiny numbers overflow the 28 px chip and collide with the next chip. Seen: `0.00000016` overlaps its neighbour in the ingredients of the Cobalt steel row (Metals), and `12361` and `20067` fill their chips edge to edge in Ores. Rates need a compact format ("12k", "<0.01") that always fits the chip.
- Dark item icons (carbon, rubber, coal-like items) have almost no contrast against the dark surface and read as holes. A chip background plate would fix this and the numbers at once.
- The 28 px item icon is small for how much the table relies on it.

Ideas to compare: a small dark pill behind the number; compact number formatting; a lighter chip background; a 32 px chip (cost: one fewer chip per line in Byproducts and Ingredients, see the 34 px chip slot in the spec).

*Decision (2026-11-08, after trying the toggles):* **accepted:** `chipFmt` (compact rates), `chipNum` (the quantity goes from 9 px to 11 px, still outlined in black), `chipPlate` (a washed-out plate behind each icon, `rgba(148,163,184,0.09)`; the first version, white at 0.12, was too distracting) and `chipBig` (32 px chips). **Rejected:** the dark background behind the numbers (`chipPill`); it was first split from the size increase (`chipNum`) so each could be judged alone. All four accepted toggles are on when the page opens, in the closed "Decided" section.

Seen in: `metals.png`, `ores.png`. Files: `IconChip.tsx` (the `text-[9px]` quantity, `QUANTITY_COLOR`), `ItemChip.tsx`, the rate formatter used by the chips.

### 4. Secondary text and some controls have low contrast

Noticed: the "click a row to trace it" hint and the item counts in the overview; the ▲/▼ reorder arrows, which are nearly invisible although they are controls; the side-panel section labels (RATE, MACHINE, BEACONS); the `–` cells of the Effects table; the `+` new-block button; and the **All blocks ▾** overflow button at the right of the tab strip, which shows as a tiny dot (visible in `hub.png`, next to "Extr"). Check each against 4.5:1 (text) or 3:1 (controls) before choosing new greys.

*Decision (2026-11-08):* **accepted as is:** `contrast` (lighter hints, counts, reorder arrows, header and panel labels, and the bordered `+` and block-list buttons). On when the page opens, in the closed "Decided" section.

### 5. Collapsed group rows are noisy and change height

- Every area row carries an "Area" tag, then "N recipes · N machines", and in Hub both numbers are the same ("114 recipes · 114 machines"). When every row of a table is an area, the tag adds nothing.
- Row height jumps from 33 px to 66 px (Hub, Metal Ores) when a group's chips wrap onto a second line, and a long list ends in a small dim "+30" / "+33" / "+6". *Corrected while building the artifact:* the +N is already a button that opens a popup with every hidden item and its rate ("Also sends" / "Also receives", `AreaChipsMore.tsx`), so the information is not lost; the cost is the second line. The cap is a fixed count (8 sent, 16 received), not "two lines".
- Group rows and recipe rows differ by the tag and a faint tint (`groupRowTint`, gray-800 at 30%, fainter with depth); only areas carry the Area tag and flow chips, plain sub-factories show counts and power only. A stronger band and a heavier name would make the tree readable at a glance.

Ideas to compare: drop the tag when all siblings are areas, or move it to an icon; show "114 recipes" only when it differs from the machine count; one fixed row height (the popup stays as it is); a band for group rows.

*Owner's review (2026-11-08):* **accepted:** `grpFixed` (one fixed row height; the popup stays as it is). Now on when the page opens, in the Decided section. **`grpTag`, replaced:** the idea of a quieter label is liked, but "no tag only when every sibling is an area" was confusing; `grpIcon` replaces it: a 12 px icon before the name on every group row, always, so a table of areas and a mixed table look the same. The areas icon of the toolbar marks a separate area, a folder marks a plain sub-factory; the Area tag goes, and the count reads "N machines" when it equals the recipe count (kept from `grpTag`). **`grpBand`, reworked:** the band and heavier name were too noisy (a table of areas turned into a different table when collapsed, and distracted from the content when open); the name weight is no longer touched and only an **open** group gets a faint tint, a hairline under its header and a teal icon, so collapsed rows keep the usual look. *Decision (2026-11-08, after trying both):* **accepted:** `grpIcon` and the reworked `grpBand`. Both are on when the page opens, in the Decided section. Finding 5 is judged.

Seen in: `hub.png`, `ores.png`. Files: `RecipeRow.tsx` (sub-factory row), `AreaChipsMore.tsx`, `treeGuides.ts`.

### 6. Empty placeholders repeat on every recipe row

Every plain recipe row shows a dashed `+ 0/3` module chip and a dashed `+` beacon chip (`ores.png`, `extra-sulfur.png`). Over a long table this is noise. Idea: show them on row hover, on selection or on keyboard focus only. The cost is discoverability and touch (no hover), which the backlog's touch items already worry about, so a variant should keep them visible on touch.

Files: `MachineCell.tsx`, `ModuleCell.tsx`, `BeaconPopover.tsx` (`BeaconCell`).

*Owner's review (2026-11-08):* **rejected:** `hideEmpty` (dashed chips only on hover, selection or focus): the placeholders should stay visible. Removed from the replica. Two ideas from the owner replace it: `phPair` (an empty Beacons cell shows two placeholders, the beacon `+` and its module slot `+ 0/2`, like the Machine cell; the app today shows one `+` until a beacon exists, then the beacon chip and its module chip) and `phQuiet` (the dashed border and glyph get fainter, from 2.35:1 and 3.67:1 against the row to 1.72:1 and 2.35:1; back to the usual tone on row hover, selection and keyboard focus, brighter on the chip itself; never hidden, so touch screens look the same). `phQuiet` knowingly goes below 3:1 for a decorative empty-state hint; the readout's contrast card does not count it.

*Decision (2026-11-08, after trying both):* **accepted:** `phPair` and `phQuiet`. Both are on when the page opens, in the closed "Decided" section.

### 7. The side panel is long, has dead space, and covers everything below `xl`

- For a recipe row, the Effects table is a grid of dashes while no module or beacon is set; hide or collapse it until there is something to show. "Where inputs come from" then moves up from the bottom edge of a 900 px screen.
- "Pin rate" is a native white checkbox on a dark panel. A styled switch would match.
- For an area the panel is good (summary, receives, sends, inside this group; see `metals-area-selected.png`), but its lists are long (Hub's Top Row receives 26 items) and take the full height.
- At 1024 px the panel becomes a drawer that covers more than half the screen and hides the selected row's columns, so the player cannot see what they are editing (`hub-1024-drawer.png`). Idea: a narrower drawer, or a bottom sheet on short and narrow screens.

*Owner's review (2026-11-08):* **accepted:** `panDash` (hide the empty Effects table until a module or beacon is set), `panLists` (cap Receives and Sends at 6, "Show all N" to expand) and `panNarrow` (drawer of 300 px at most below 1280 px). **`panSwitch`, accepted with a change:** the styled switch is kept, and once the rate is pinned the rate input sits on the **same line** as the switch ("Pin rate", then the input and `/min`) instead of on a line of its own; the section no longer grows when pinning. **Rejected:** `panSheet` (bottom sheet below 1280 px), removed from the page and from `check-artifact.mjs`. The four accepted toggles are on when the page opens, in the Decided section "7 · Side panel". Finding 7 is judged.

Files: `src/components/factory/sidePanel/`, `FactoryShell.tsx`.

### 8. Row selection is subtle

A selected row has a 3 px teal bar on the left of the reorder cell and a faint tint. With dozens of rows and the panel open it is easy to lose which row the panel is about (`metals-area-selected.png`: Aluminium is selected, and you have to look for the bar). Ideas: a stronger tint, a teal outline, or a brighter name.

*Decision (2026-11-08):* **accepted as is:** `selStrong` (full-row tint, teal outline and a brighter name). On when the page opens, in the closed "Decided" section.

### 9. The block tabs overflow on a real plan and the top bar is unbalanced

- With 11 blocks at 1440 px the strip is cut at both ends: the first tab reads "nces" and the active tab "Extr" (`hub.png`). At 1920 px they fit. The cut-off tab names are what the user sees most of the time.
- An inactive tab's colour stripe is barely visible, and the tabs are small and low-contrast.
- The workspace button on the right carries more visual weight than the tabs. The block graph, areas and tech tree buttons are unlabeled icons that only a tooltip explains.

Ideas to compare: a smaller minimum tab width or two-line tabs; icon-only tabs for inactive blocks; a lighter workspace button; a text label on the view buttons at wide widths.

*Owner's note (2026-11-08):* if compact tabs get the styled tooltip (`tabsFit`), it must show on keyboard focus as well as on hover.

*Decision (2026-11-08, after trying both):* **accepted:** `tabsFit` (inactive tabs show their icon only, the name in the styled tooltip; "it looks so much better") and a lighter workspace button, now `wsLight` (no fill and no border, 32 px high like the tool buttons). **Rejected:** the text labels on the tool buttons: they take too much width, and hovering the icon already says what a button does. The toggle `topLabels` is split: the labels are removed, the workspace button stays as `wsLight`. `wsLight` only changes the button that opens the workspace menu; `WorkspaceMenu.tsx` and its contents are untouched. Both are on when the page opens, in the closed "Decided" section.

*Follow-up (2026-11-08):* with all tabs fitting, the "All blocks ▾" overflow button no longer exists. The owner is fine with that but wants a way to list every block, so a new proposal `blockList` adds an icon before the first tab that opens the list of all blocks (icon and name per row), whether tabs fit or not; it replaces the overflow button when on. *Accepted (2026-11-08):* `blockList`, on when the page opens in the "Decided" section.

*Follow-up (2026-11-08):* the owner asked for the `+` that adds a block to be a regular top-bar icon: today it is a 28 px text `+` followed by a 16 px gap, so it floats to the left of the four tool icons. New proposal `addTool`: a 32 px icon button in the same row and spacing as Horizon, Graph, Areas and Tech tree, with the same black tooltip. *Accepted (2026-11-08):* `addTool`, on when the page opens in the "Decided" section.

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
- Deep nesting: the artifact expands groups (Hub's Top Row has three plain sub-factories below it) but the reference plan has no area inside an area.
- Accessibility measurements beyond the dim greys: the artifact computes WCAG ratios for the hints, counts, arrows and labels only.
- The smaller blocks (Sciences, Circuits, Agricultural Science, Mod 1, Sludge, Bean 1, Clay Brick) are in the artifact because every tab opens, but they were not reviewed against screenshots.

## After the artifact

Accepted findings become items in [../backlog.md](../backlog.md) under UI / UX, or one follow-up plan in this folder when several touch the same files (findings 1, 2 and 10 all change the vertical or horizontal budget, and 3 and 6 both change the chips and rows). When the changes ship, update [../../spec/ui.md](../../spec/ui.md) (the sizes it quotes) and move this folder to `initiatives/archive/`.
