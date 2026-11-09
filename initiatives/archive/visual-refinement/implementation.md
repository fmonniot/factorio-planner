# Visual refinement: implementation plan

Status: Active

The follow-up plan to [plan.md](plan.md). The design artifact is judged: 28 changes accepted, 11 variants rejected (2026-11-08). This document is the input for the sessions that put the accepted changes into `src/components/`, one pull request each. Nothing is implemented yet.

**How to use it.** Read [Ground rules](#ground-rules), then work one PR section at a time. The [ledger](#ledger) lists every accepted change exactly once and `npm run lint:docs` fails when it drifts from the artifact (see [Not missing anything](#not-missing-anything)). The *Landed* column is ticked by the orchestrator after the merges, not by the PRs (see [Orchestration](#orchestration)).

---

## Ground rules

1. **The artifact is the specification.** `artifact/project/Main.dc.html` (with every toggle on, which is how it opens) is the target; the numbers below were read from it. When this document and the artifact disagree on a number, the artifact wins and this document gets fixed. The replica's colours are hex values of the Tailwind v4 gray palette: `#1e2939` gray-800, `#364153` gray-700, `#4a5565` gray-600, `#6a7282` gray-500, `#99a1af` gray-400, `#d1d5dc` gray-300, `#101828` gray-900. Use the class, not the hex.
2. **The artifact is a replica, not the app.** Its "Not drawn" list (pickers, modals, menus behind the workspace and tool buttons, reordering, drag and drop, the light theme, the Nullius data set, areas inside areas) says what was never judged; keep the app's behaviour there. The readout cards, the Decided section and the device frames are artifact-only and are not to be built.
3. **Look at the real component first.** Names below are the places the plan points at; the current classes and structure may differ from what plan.md assumed. Where the app already does what a change asks, say so in the PR and move on (`dedicatedProduct` below is such a case).
4. **Row density is a budget (finding 11).** Every PR that changes a height or a width states in its description the cost per row and the rows visible at 1440 × 900, against `main`.
5. **Tests.** A unit test beside the source where the logic is pure (formatters, layout arithmetic), a Playwright spec in `e2e/` for what a user sees or does (CLAUDE.md prefers it over manual checks). Each ledger row names the artifact check that proves the claim in the replica; the app test should assert the same thing. `e2e/fixtures/` has plans; [../share-by-url/sample-plan-middle-ring.json](../share-by-url/sample-plan-middle-ring.json) is a Seablock plan from the same game. The block names in the artifact's "Try:" lines (Hub, Metals, Ores, Extra Sulfur) come from the owner's personal save, which is not in the repository; they are a guide, not the test input.
6. **Docs travel with the code.** Per CLAUDE.md "Spec maintenance": UI changes update [../../spec/ui.md](../../spec/ui.md) (it quotes sizes) and, when user-visible, README "Using the planner". Do not edit the ledger or its *Landed* column in a PR: all nine PRs would edit adjacent lines of one table and conflict.
7. **Settings and state.** Wherever this document says a choice "survives a reload", follow how the app already stores UI state; do not invent a new store.

## Branching and order

PR 0 is the branch that holds this file (docs, tooling and the artifact; nothing under `src/`). Merge it first, then branch every PR below from `main`, except where *Base* says *stacked*: those depend on a previous PR's sizes and are cut from its branch, then rebased onto `main` when it merges.

| PR | Theme | Base | Why this order |
|---|---|---|---|
| 1 | Contrast | main | Touches colours in many files; landing it first keeps later conflicts small |
| 2 | Selected row | main | Independent |
| 3 | Top bar | main | Independent |
| 4 | Side panel | main | Independent |
| 5 | Chips and placeholders | main | Sets the chip size and row heights that 6 and 7 build on |
| 6 | Group rows and ingredient alignment | stacked on 5 | Chip counts per line depend on the chip slot (34 or 38 px) |
| 7 | Narrow screens | stacked on 6 | Row heights (37 + 36: PR 5 leaves a plain recipe row at 37 px) and the 554 px minimum depend on 5 and 6 |
| 8 | Summary detail and bars | main | Independent of the table |
| 9 | Collapsed summary | stacked on 8 | `sumStack` needs `sumLine`; the one-line chips reuse the pane code PR 8 touches |

Each of the nine PRs below stays its own PR, however small (owner, 2026-11-08): it keeps the release notes readable. Do not merge neighbours; do not split one either.

## Orchestration

The nine PRs are run by one orchestrator session that writes no app code and spawns agents. That session may be restarted from scratch at any time (token limits), so it keeps no state of its own: GitHub is the state.

- Names: branch `visual-refinement/pr-N-<slug>`, PR title `Visual refinement N/9: <theme>`. After a restart, find the state with `gh pr list --state all --search "Visual refinement in:title"` and `git branch -r`; continue from there and never redo a PR that exists.
- Implementer agents, one per PR, each in its own git worktree. An implementer gets only its PR section verbatim (every "Not in the artifact" note included), the ground rules and the artifact path. It writes the code and its tests, updates the docs the ground rules name, runs lint, lint:docs, test:unit, test:e2e and build, opens the PR and reports the cost per row and rows visible at 1440 × 900 against `main` (ground rule 4).
- Waves: PRs 1, 2, 3, 4, 5 and 8 in parallel; 6, 7 and 9 start once their base PR is open (6 on 5, 7 on 6, 9 on 8), from that PR's branch, without waiting for it to merge. The owner merges in order 1 to 9; when a merge makes another branch conflict, its agent rebases it.
- Review: one round per PR, enough given how much the artifact already settles. A reviewer agent runs the code-review skill at high on the PR; a separate fix agent applies the confirmed findings and pushes. The orchestrator then posts a PR comment starting `Review round done:` with whatever is left; the comment's absence means the round is not done. Never max or ultra.
- Never merge, never push to `main`, never force-push a branch other work is based on. Stop and ask the owner when the section contradicts the app's code or the artifact, or a test cannot be made to pass.
- Report as a table (PR, branch, number, review state, open findings, blockers) after each wave.
- Closing: once all nine are merged, tick the *Landed* column in one commit on a branch of its own, then run `node initiatives/visual-refinement/check-ledger.mjs --audit`.

---

## Ledger

One row per accepted change. *Artifact check* is the start of a check name in [check-artifact.mjs](check-artifact.mjs) (`none` means the replica has no dedicated assertion: measure it, see the PR section). *Landed* is the app PR number once merged, `—` before.

| Change | Finding | PR | Artifact check | Landed |
|---|---|---|---|---|
| `contrast` | 4 | 1 | `4 contrast` | #244 |
| `selStrong` | 8 | 2 | `8 selStrong` | #243 |
| `tabsFit` | 9 | 3 | `9 tabsFit` | #247 |
| `wsLight` | 9 | 3 | `9 tool buttons` | #247 |
| `blockList` | 9 | 3 | `9 blockList` | #247 |
| `addTool` | 9 | 3 | `9 addTool` | #247 |
| `panDash` | 7 | 4 | `7 panDash` | #245 |
| `panSwitch` | 7 | 4 | `7 panSwitch and panLists` | #245 |
| `panLists` | 7 | 4 | `7 panSwitch and panLists` | #245 |
| `panNarrow` | 7 | 4 | `7 panNarrow` | #245 |
| `chipFmt` | 3 | 5 | `3 chipFmt` | #248 |
| `chipNum` | 3 | 5 | `3 chipNum and chipPlate` | #248 |
| `chipPlate` | 3 | 5 | `3 chipNum and chipPlate` | #248 |
| `chipBig` | 3 | 5 | none | #248 |
| `phPair` | 6 | 5 | `6 phPair` | #248 |
| `phQuiet` | 6 | 5 | `6 phQuiet` | #248 |
| `grpFixed` | 5 | 6 | `5 grpFixed` | #250 |
| `grpIcon` | 5 | 6 | `5 grpIcon` | #250 |
| `grpBand` | 5 | 6 | `5 grpBand` | #250 |
| `ingLeft` | 2 | 6 | `2 ingLeft` | #250 |
| `narrowToolbar` | 10 | 7 | none | #251 |
| `narrowStack` | 10 | 7 | `10 narrowStack` | #251 |
| `sumShort` | 1 | 8 | `1 sumShort` | #246 |
| `legTip` | 1 | 8 | `1 legTip` | #246 |
| `legInBar` | 1 | 8 | `1 legInBar` | #246 |
| `ovBar` | 1 | 8 | `1 ovBar` | #246 |
| `sumLine` | 1 | 9 | `1 sumLine` | #249 |
| `sumStack` | 1 | 9 | `1 sumStack` | #249 |

## Rejected

Do not implement these. They were tried in the replica and removed from it.

| Variant | Finding | Why |
|---|---|---|
| `legMenu` | 1 | Two-line 36 px legend bar with the actions as icon buttons: rejected after trying it |
| `sumNoSum` | 1 | Counts instead of sums: the item count is key information in the strip |
| `sumFit` | 1 | Pane height follows content: the `+N` tile made hidden items harder to click than scrolling; once the scroll was kept the height barely changed |
| `colRecipe` | 2 | Extra width to the Recipe column |
| `colTrail` | 2 | Chip columns together, spare width at the right |
| `colCap` | 2 | Cap the table at 1160 px |
| `chipPill` | 3 | Dark background behind the numbers (the size increase `chipNum` was split out and accepted) |
| `grpTag` | 5 | Drop the Area tag only when every sibling is an area: confusing; replaced by `grpIcon` |
| `hideEmpty` | 6 | Dashed placeholders only on hover, selection or focus: they must stay visible |
| `panSheet` | 7 | Bottom sheet instead of a drawer below 1280 px |
| `topLabels` | 9 | Text labels on the tool buttons: too wide, the tooltip is enough |

The first `grpBand` (band on every group row, heavier name) was also rejected and reworked into the accepted `grpBand` below; the name weight stays untouched.

---

## PR 1 · Contrast

Base: main. Finding 4. Files: wherever the dim greys live (search `text-gray-500`, `text-gray-600`, `border-gray-600` under `src/components/`); the ▲/▼ cells in `RecipeRow.tsx`, the header in `ProductionTable.tsx`, the side-panel section labels in `sidePanel/PanelParts.tsx`, `FactorySummary.tsx` hints and counts, the tool buttons (`IconButton.tsx`).

- **`contrast`**: dim text (hints such as "click a row to trace it", overview item counts, header labels, the RATE / MACHINE / BEACONS panel labels, the `–` cells) goes from gray-500 `#6a7282` to gray-400 `#99a1af`; the reorder arrows from gray-600 `#4a5565` to gray-400; the tool icons (Horizon, Graph, Areas, Tech tree) from gray-400 to gray-300 `#d1d5dc`. Check each result against 4.5:1 for text and 3:1 for controls on its surface (the artifact computes WCAG ratios in its readout; its lowest ratio with the change is the target). Proof: `4 contrast`; also assert that the arrows still reorder.
  - The replica also draws the `+` (new block) and the All blocks `▾` as bordered buttons (`1px solid #4a5565`, gray-300 icon, 34 px wide for All blocks). In the accepted state those two buttons no longer exist and stay gone (owner, 2026-11-08): `addTool` and `blockList` (PR 3) replace them, with gray-300 icons and no border. So PR 1 does not restyle them; PR 3 builds the replacements in the new colour.
  - `phQuiet` (PR 5) deliberately goes below 3:1 on the placeholders; do not "fix" it here.

## PR 2 · Selected row

Base: main. Finding 8. Files: `RecipeRow.tsx` (and the group-row variant), `ProductionTable.tsx`.

- **`selStrong`**: the selected row gets a full-row tint `rgba(20,184,166,0.22)` (teal-500 at 22%, replacing `bg-teal-900/25`), a 3 px inset bar on the left `#2dd4bf` (teal-400, as today) plus a 1 px inset outline `rgba(45,212,191,0.65)` around the whole row, and a brighter name (white, bold). Group rows too. The artifact selects on a click anywhere on the row; keep what the app does. Proof: `8 selStrong`. Interplay: PR 6's open-group hairline is not drawn on a selected row.

## PR 3 · Top bar

Base: main. Finding 9. Files: `BlockTabs.tsx`, `TopBar.tsx`, `IconButton.tsx`; `WorkspaceMenu.tsx` is not touched (only the button that opens it changes).

- **`tabsFit`**: inactive tabs show their block icon only, 44 px wide; the active tab keeps its name and today's width. The name of an inactive tab is shown in the same black tooltip the tool buttons use (`IconButton.tsx`, `border-gray-700`) instead of the browser `title`. The colour stripe on an inactive tab goes from 2 px at 55% opacity to 3 px at 85% (the active one: 3 px, full). The strip stays centred on the active tab. **Not in the artifact:** the tooltip must also appear on keyboard focus, not just on hover (owner, 2026-11-08). Proof: `9 tabsFit`; add a focus assertion.
- **`wsLight`**: the workspace button has no fill and no border and is 32 px high, like the tool buttons; its width goes from 136 to 132 px; from 768 px up. Under 768 px it stays the compact 62 px button. The menu behind it is unchanged. Proof: `9 tool buttons`.
- **`blockList`**: a 28 × 28 icon button before the first tab opens the list of all blocks (icon and name per row, picking one switches block, Escape closes it). It is always visible, whether tabs fit or not, and replaces the "All blocks ▾" overflow button at the right of the tabs (which only existed while tabs overflowed): remove that button. Proof: `9 blockList`.
- **`addTool`**: the add-block `+` becomes a 32 × 32 icon button in the same row and spacing as the four tool icons (no 16 px gap before the group), gray-300 icon, same black tooltip. Proof: `9 addTool`.

## PR 4 · Side panel

Base: main. Finding 7. Files: `src/components/factory/sidePanel/` (`RecipePanel.tsx`, `GroupPanel.tsx`, `EffectsSection.tsx`, `RateSection.tsx`, `PanelParts.tsx`), `FactoryShell.tsx` for the drawer.

- **`panDash`**: for a recipe row, the Effects section is not rendered until a module or a beacon is set; "Where inputs come from" moves up. It appears as soon as one is set. Proof: `7 panDash`.
- **`panSwitch`**: the Pin rate checkbox becomes a styled switch matching the dark panel. Once pinned, the rate input sits on the **same line** as the switch ("Pin rate", the switch, then the input and `/min`, 16 px between the switch and the input group, 8 px inside it); the section keeps its height when pinning (66 px in the replica, instead of growing to 98). Proof: `7 panSwitch and panLists`.
- **`panLists`**: on a group or area panel, Receives and Sends show at most 6 entries; a "Show all N" button expands the list. Proof: `7 panSwitch and panLists`.
- **`panNarrow`**: below 1280 px (where the panel is a drawer over the table) its width is `min(300, max(200, viewport - 140))` instead of 380 px (full width under 640 px today), so the selected row's first columns stay visible. From 1280 px the panel stays docked at 380 px. Escape and the backdrop still close it. Proof: `7 panNarrow`.

## PR 5 · Chips and placeholders

Base: main. Findings 3 and 6. Files: `IconChip.tsx`, `ItemChip.tsx`, `ItemTile.tsx` (`fmtRate` lives there), `MachineCell.tsx`, `ModuleCell.tsx`, `BeaconPopover.tsx` (`BeaconCell`), `RecipeRow.tsx` and `ProductionTable.tsx` for the chip slot width.

- **`chipFmt`**: the quantity on a table chip is formatted to always fit: `>= 10000` rounds to thousands with `k` (`12k`), `>= 1000` one decimal with `k` (`1.1k`, `.0` dropped), `>= 100` no decimals, `>= 1` one decimal, `>= 0.01` two decimals without the leading zero (`.05`), below that `<.01`. Chip tooltips keep the exact rate (`Name — 1.6e-6/m`, as today). This formatter is for the chips only; `fmtRate` elsewhere is unchanged. Proof: `3 chipFmt`; a unit test for the thresholds (replica: `fmtCompact`).
- **`chipNum`**: the quantity goes from 9 px to 11 px bold monospace, still outlined in black (1 px text-shadow in four directions), bottom-right. Proof: `3 chipNum and chipPlate`.
- **`chipPlate`**: a washed-out plate behind each item icon: `rgba(148,163,184,0.09)` fill, 5 px radius, 1 px inset ring `rgba(148,163,184,0.10)`. The first version (white at 12%) was too distracting; keep it faint. Proof: `3 chipNum and chipPlate`.
- **`chipBig`**: item chips go from a 28 px icon in a 34 px slot to 32 px in a 38 px slot (machine chips stay 32 px). A plain recipe row stays 37 px (its machine, module and beacon chips are still 32 px and set the height; no padding is added to reach 41), an area row line grows 33 → 37 px, and each line holds fewer chips (floor of the column width over the slot). No artifact assertion; the replica's readout shows "average row height" and "rows visible". The PR description gives both against `main` (finding 11).
- **`phPair`**: an empty Beacons cell shows two placeholders side by side, the beacon `+` and its module slot `+ 0/2`, like the Machine cell does; a filled beacon looks as today. Proof: `6 phPair`.
- **`phQuiet`**: placeholders (dashed border) are fainter at rest: border gray-700 `#364153`, glyph gray-600 `#4a5565` (from gray-600 `#4a5565` and gray-400 `#99a1af`). On row hover, on the selected row and on keyboard focus within the row they return to border gray-600 and glyph gray-400, and on the placeholder itself (hover or focus-visible) to border gray-400 and glyph gray-200. Never hidden, so touch screens look the same. Proof: `6 phQuiet`.

## PR 6 · Group rows and ingredient alignment

Base: stacked on PR 5. Findings 5 and 2. Files: `RecipeRow.tsx` (group and area rows), `AreaChipsMore.tsx`, `treeGuides.ts`, `ProductionTable.tsx` (`COLUMNS`, header).

- **`grpFixed`**: a group or area row is always one line high (33 px; 37 px with PR 5): the chips that fit on one line are shown and the rest sit behind the `+N`, which keeps opening today's popup ("Also sends" / "Also receives"; its caps of 8 and 16 are unchanged). When everything fits all chips show; otherwise one fewer than fits plus the `+N`. Proof: `5 grpFixed`.
- **`grpIcon`**: every group row gets a 12 px icon before its name, always (so a table of areas and a mixed table look alike): the areas icon of the toolbar for a separate area, a folder for a plain sub-factory. The "Area" tag goes. The count reads "N machines" when it equals the recipe count, else "N recipes · M machines". Icon colour gray-400; its tooltip names it. Proof: `5 grpIcon`.
- **`grpBand`**: only a group that is **open** gets a band: background `rgba(45,212,191,0.05)` (teal-400 at 5%, instead of its depth-faded gray tint), a 1 px hairline under its header `rgba(45,212,191,0.28)` (not drawn on a selected row) and a teal-400 icon. Collapsed rows keep today's look (`groupRowTint`, gray-800 at 30%, fainter with depth) and the name weight is untouched. Proof: `5 grpBand`.
- **`ingLeft`**: the ingredient chips are left-aligned in their column instead of right-aligned; Power keeps its right-aligned column. Area rows borrow 28 px from the Products span for their `+N`, so area rows start their first ingredient chip after that offset, and recipe rows get the same 28 px of left padding (and hold one chip fewer per line) so both start at the same x. The "Ingredients" header is left-aligned over the chips at the same offset (8 + 28 px). Column widths and the 3 : 2 : 4 split are unchanged. Measured in the replica at 1920 × 1080 with the panel closed: gap from the last product chip to the first ingredient chip 624 → 237 px on Ores and 846 → 365 px on Metals. Proof: `2 ingLeft`.

## PR 7 · Narrow screens

Base: stacked on PR 6. Finding 10. Applies under 768 px. Files: `ProductionTable.tsx`, `RecipeRow.tsx`, `TableToolbar.tsx`, `MachineCell.tsx`, `ModuleCell.tsx`.

- **`narrowToolbar`**: the table toolbar does not wrap: `+ Recipe` stays on one line, the recipe, machine and power counts are single-line, the warnings pill is the compact `⚠ 1` instead of `⚠ 1 warning ▾` (8 px padding instead of 12). No artifact assertion; the app test checks that the toolbar is one line high at 416 px.
- **`narrowStack`**: the Machine and Beacons columns are dropped from the table (their chips sit under the recipe name; group rows lose the 176 px of empty space they took); the table minimum width becomes 554 px. A recipe row has one fixed height, 37 + 36 px (unchanged by PR 5, which leaves a plain recipe row at 37 px): at most two lines of chips per column in Byproducts and Ingredients; a column with more chips shows one fewer than two lines hold and a `+N` in the last slot. **Not in the app today:** that `+N` opens a list next to the button on click ("More byproducts" / "More ingredients"); the area rows' `+N` list is anchored the same way. Products always shows exactly one chip. Proof: `10 narrowStack` (both checks).
  - The product of a row is `dedicatedProduct` (the row's `primaryProduct`, else the recipe's `mainProduct`, else its first product). The app already does this; only the artifact's data extractor was wrong and has been fixed. Nothing to implement, but keep it when touching the Products column.

## PR 8 · Summary detail and bars

Base: main. Finding 1. Files: `SummaryDetailStrip.tsx`, `SummaryPane.tsx`, `FactorySummary.tsx`, `summarySegments.ts`, `summaryRows.ts`, `segmentLooks.ts`, `ItemTile.tsx`.

- **`sumShort`**: the detail strip stays a fixed height (no layout shift on selection) but drops from 110 to 72 px: the colour key and the actions share one line, and the overview shows about one row instead of three (the real cost). The summary grid keeps its `max-h-[97px]` and its scroll; the pane padding is 5 / 10 / 3 px with a bar, 6 / 10 / 4 without. Proof: `1 sumShort`.
- **`legTip` and `legInBar`, combined** (settled with the owner): the bar for a selected item with several sources grows to 16 px and carries the text itself: name and amount when the segment is wide enough (amount width + 46 px), the amount alone when it is narrower (amount width + 4 px), nothing when tiny. The black tooltip (same as the tool buttons) on hover or focus of a segment (tap on touch) always carries the full information: name, amount and note; the separate key line goes. The actions keep their line. Give segments an accessible name with the same text. Proof: `1 legTip`, `1 legInBar`.
- **`ovBar`**: the overview rows become one stacked bar like a selected item's, each segment sized by its share of the pane's total; hover or click traces (dims the slots without that key, as the rows do); the item count rides along ("381 · 14") when it fits. The legend rules above apply to it. Proof: `1 ovBar`. Known weakness: a segment of about 12% shows only its amount, so colour, tooltip and accessible name must carry the rest.

## PR 9 · Collapsed summary

Base: stacked on PR 8. Finding 1. Files: `FactorySummary.tsx`, `SummaryPane.tsx`, the layout code that measures the space above the table.

- **`sumLine`**: a persistent collapse / expand toggle (not an overlay). Collapsed: one 40 px line per pane (counts and as many 24 px chips, in 30 px slots, as fit, then a `+N` that opens the list of every item with its rate; informational, not clickable per item) and an Expand button (68 px) at the right, which sticks to the right edge when the panes scroll sideways on narrow screens. Expanded: the three panes as before plus an 18 px handle row with "Collapse summary". Expanding pushes the table down. The choice survives block switches. **Not in the artifact:** it also survives a reload (owner, 2026-11-08); the replica does not store it. The default is collapsed, for everyone who has not set it (owner, 2026-11-08), as in the replica. Under 768 px the one-line summary drops its chips and scrolls. Proof: `1 sumLine`.
- **`sumStack`** (needs `sumLine`): under 768 px the three collapsed lines (34 px each) sit on top of each other instead of scrolling sideways, and the 18 px handle row carries Expand / Collapse in both states. Expanded, the panes scroll sideways as before (a stacked expanded strip would be about 720 px, more than the Fold cover's 657). From 768 px up (the Fold inner screen) the three columns stay. Proof: `1 sumStack`.

---

## Not missing anything

The accepted changes live in three places that do not overlap completely: the artifact's toggles, the decision notes in plan.md and the prose-only requirements. Three guards:

1. **The ledger is checked against the artifact.** [check-ledger.mjs](check-ledger.mjs) (run by `npm run lint:docs`, so by CI) fails when: the set of ledger changes differs from `DECIDED` in `Main.dc.html`; a change has no PR, no unique bullet in its PR section or an artifact check that does not exist; a rejected variant is still in the page; or plan.md, HANDOFF.md or this file names a toggle-like identifier that is neither accepted nor rejected here. A change added to the artifact without a ledger row, or the other way round, cannot pass.
2. **Closing audit.** `node initiatives/visual-refinement/check-ledger.mjs --audit` additionally fails while any *Landed* cell is `—`. Run it in the last PR; when it passes, archive the folder (`git mv`, update [../README.md](../README.md)) and remove the script from `lint:docs` in the same commit.
3. **Reconciled against the history (2026-11-08).** The ten commits of the branch, one per finding (plus the one that made the finding-1 toggles default to on), were read against this ledger: every accepted and rejected variant they name is here, and the plan.md lines they removed were wording only (the brief becoming a record), no decision. The three requirements that exist only in prose are marked **Not in the artifact** above: the keyboard-focus tooltip on compact tabs (`tabsFit`), the persisted collapsed state (`sumLine`) and the new `+N` list on recipe rows (`narrowStack`).
