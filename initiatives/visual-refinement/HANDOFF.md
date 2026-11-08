# Visual refinement: session handoff

Working notes so a fresh session can pick up the design artifact without reloading the earlier sessions. [plan.md](plan.md) is the brief (findings, baseline measurements); this file is the state of the work. Last updated 2026-11-08.

## Where things stand

- The design artifact exists: <https://claude.ai/artifact/N8pwXR8kxgrzJpqh7wirDK> (private to the owner, type "Design" canvas, title "Main screen refinement"). Published version 6 (the interactive rebuild, measured Fold sizes, no phone screen, no sidebar block picker); the two assets of version 4 are still stored, unused. It covers all ten fixable findings (1 to 10; 11 is the row-density budget the readout tracks) and the owner's devices.
- **Finding 1 (summary strips) is judged** (2026-11-08, recorded in plan.md): accepted `sumShort`, `legTip`, `legInBar`, `ovBar`, `sumLine`, `sumStack`; rejected `legMenu`. `legMenu` is removed from the page and from `check-artifact.mjs`. The six accepted toggles (`DECIDED` in `Main.dc.html`) are **on when the page opens** and sit in a **closed section** ("Decided: 1 · Summary strip") above the open ones; "Decided only" returns to that state, "All off" clears everything, "All changes on" turns all on. Add a finding to `DECIDED` and give its group `decided: true` when the owner accepts it. **Findings 2 to 10 have not been judged**; step 5 of the brief stays open for them.
- The previous version of the page was a picture with toggles: several things the toggle texts promised were not implemented (placeholders that never appeared on hover, a table that could not scroll, tabs that could not be clicked, a `+N` that did nothing, a side panel whose "empty Effects table" could never become non-empty). This session rebuilt the page so that **every toggle can be tried**, and added [check-artifact.mjs](check-artifact.mjs), which turns each toggle's description and "Try:" line into an assertion. Run it after every edit; do not add a toggle without a check.
- Nothing under `src/` changed. Nothing is committed (branch `main`; this folder is untracked or modified).

## What the page does

One interactive board, `artifact/project/Main.dc.html` (2340 × 1720), plus the index `artifact/project/canvas.json`.

- **Replica of the screen** on six screens (`DEVICES`): **Fold 8 cover** 416 × 657, **Fold 8 inner** 816 × 616 (both measured by the owner; the Fold is their phone, so there is no 390 × 844 screen), **iPad A16** 820 × 1180 and landscape 1180 × 820, Laptop 1440 × 900, Desktop 1920 × 1080, scaled to fit. **All 11 blocks** of the plan are real; the tabs (and the All blocks menu) are the only block switcher, there is no picker in the sidebar.
- **Real content, real logic.** Rows, chips and rates come from the app's solver. The three summary panes (slots, segment bars, key entries, overview rows such as `← Metals 381 · 14`) come from the app's own `productSlot`, `byproductSlot`, `ingredientSlot` and `overviewRows`, so counts match the app (Ores: 24 ingredients, Metals: 29). The Hub, Metals and phone baselines reproduce the owner's screenshots.
- **Interactions in the replica** (all asserted by `check-artifact.mjs`): click anywhere on a row or on one of its chips to select it; `›` opens and closes a group (children indented with tree guides, plain sub-factories show counts and power only, as in the app); the table scrolls both ways with a sticky header and scrolls the selected row into view; summary slots preview on hover and select on click (✕ clears), overview rows trace (dim the slots without that key), the `+` and detail actions say they are not drawn; the `+N` on an area row opens the app's popup ("Also sends" / "Also receives"; click here, hover in the app); tabs switch block, **All blocks ▾** (shown while tabs overflow) opens the real dropdown, tool buttons show the app's black tooltip, `+ Recipe`, the filter, `/sec`, the reorder arrows, module and beacon slots in the table, the workspace button and the tab `+` show a note ("not drawn"); in the side panel the module slots and the beacon button can be set (module: speed module 3, +50% speed, +70% energy; one beacon with two of them: effectivity 1.5), Pin rate toggles, long lists expand; Escape closes popovers, menus, the overlay summary and the panel.
- **One toggle per change** (`GROUPS`, each with a description and a "Try:" line shown under it): `sumShort`, `legTip`, `legInBar`, `ovBar`, `sumLine`, `sumStack` (1, decided: on at the start); `colRecipe`, `colTrail`, `colCap` (2); `chipFmt`, `chipPill`, `chipPlate`, `chipBig` (3); `contrast` (4); `grpTag`, `grpBand`, `grpFixed` (5); `hideEmpty` (6); `panDash`, `panSwitch`, `panLists`, `panNarrow`, `panSheet` (7); `selStrong` (8); `tabsFit`, `topLabels` (9); `narrowStack`, `narrowToolbar` (10). Plus a **Context** switch for the side panel. The flip button shows the baseline (all toggles ignored); "All changes on" / "All off".
- **Readout cards** (eight), each against the baseline: above the table, average row height (rows shown, so opened groups count), rows visible, gap from last product chip to first ingredient chip (240 px "one eye span" is a guess), tabs cut off, share of Products-to-Ingredients in view, side panel content height, lowest text contrast (computed WCAG ratio of the dim greys; 4.5:1 target).
- **Side panel modes:** docked 380 px from 1280 px; below that a drawer (380 px, full width under 640 px), or with `panNarrow` at most 300 px, or with `panSheet` a bottom sheet (45% of the height at most) that shrinks the table.
- **Not drawn** (the page says so in its footer): pickers and modals, the menus behind the workspace and tool buttons, reordering, drag and drop, the machine icon (machine chips show `×count`), the light theme, the Nullius data set, areas inside areas.

## Changes of fact worth knowing (they also correct plan.md)

- **The summary grid already scrolls in the app** (`SummaryPane.tsx`: `max-h-[97px] overflow-y-auto`), so every slot is reachable. The owner rejected two finding-1 toggles for that reason or related ones: `sumNoSum` (the item count is key information) and `sumFit` (once the scroll was kept, the height barely changed). Both are removed from the page.

- **The `+N` on an area row is already a popup button in the app** (`AreaChipsMore.tsx`, hover-opened, lists the hidden flows with rates). Finding 5's "the player cannot tell what hides behind it" was wrong; `grpFixed` now only changes the row height, and the baseline replica has the popup too. The cap is a fixed 8 sent / 16 received, not "two lines". plan.md is corrected.
- Only areas carry the **Area** tag and flow chips; the old page drew a "Group" tag and chips on plain sub-factories. Group rows carry a faint tint (`groupRowTint`) and a chevron; row selection in the app is `bg-teal-900/25` plus a 3 px bar.
- **Tabs use the browser's native `title`** in the app; the **tool buttons already have a styled tooltip** (`IconButton.tsx`, black, `border-gray-700`). `tabsFit` therefore proposes giving compact tabs the same tooltip: the baseline view keeps the native title, the proposal removes it.
- **The four tool icons stay visible on a phone** (flag, graph, areas, flask), next to a compact workspace button (checked against `metals-390-phone.png`). The old page hid them under 768 px.
- **Chip tooltips** in the app carry the name and the exact rate (`Name — 1.6e-6/m`), so `chipFmt` loses nothing; the replica now does the same.
- The app's rate formatter is `fmtRate` in `ItemTile.tsx` (`>= 100` no decimals, tiny rates `toPrecision(2)`); `fmtBase` copies it.
- On narrow screens the app's summary panes form a **horizontal snap strip** (85% basis); the replica scrolls sideways too.

## Screen sizes

The Fold 8 sizes are the owner's measurements (cover 416 × 657, inner 816 × 616 CSS px, folded and unfolded). The iPad A16 is 820 × 1180 CSS px (2x). `metals-390-phone.png` in `baseline/` is still the reference for the narrow layout (a 390 px phone), and the cover at 416 px behaves the same way.

## Restarting the work

Prerequisites: the owner's save `~/Downloads/factorio-plan-middle-ring-2026-11-08.json` (not in the repo; ask for a current one if the plan moved on), `npm install`, and `npx playwright install chromium` once. Work in a scratch folder (below: `$V`), never in the repo.

### 1. Regenerate the content (only if the plan or blocks change)

```sh
V=<scratch>/vr
node initiatives/visual-refinement/extract-content.mjs ~/Downloads/factorio-plan-middle-ring-2026-11-08.json $V/content.json \
  "Sciences,Hub,Agricultural Science,Circuits,Mod 1,Metals,Ores,Sludge,Bean 1,Clay Brick,Extra Sulfur"
node initiatives/visual-refinement/pack-assets.mjs $V/content.json $V/assets
```

[extract-content.mjs](extract-content.mjs) solves the plan with the app's own solver through Vite (same trick as `scripts/inspect-plan.mjs`). Per block it keeps:
- **rows**, recursively (`children` on groups and areas). A recipe row: products are the outputs matching the recipe's `mainProduct` (all outputs when it has none), byproducts are the other outputs, ingredients are the inputs. A group or area row: the net of all descendant rows (positive: products, negative: ingredients).
- **panes** (`p`, `b`, `i`): `slots` and `ov` (overview rows), computed with the app's `summarySegments.ts`, `summaryRows.ts`, `segmentLooks.ts` and `ItemTile.tsx`, mirroring `FactorySummary.tsx`. Strings (labels, amounts, notes) and colours are precomputed, so the page never reimplements them.
- **totals**: the solver's (Metals 93 machines here, 98 in the app's toolbar).

[pack-assets.mjs](pack-assets.mjs) builds `sprite.webp` (the icons used, 56 px cells, 16 columns, row-major in the order of `items`; 543 icons) and `data.json` (item names plus sprite indexes, panes, rows with `ch` children).

### 2. Upload the assets and point the page at them

The Design type wants images and data as uploaded assets, never inline. Upload each with the Artifact tool (`url`, `asset: true`, `file_path`; one file per call). The reply gives `/_blob/<id>`. Two places in `Main.dc.html` hold those ids:

| Asset | Current id | Referenced as |
|---|---|---|
| `sprite.webp` | `db38fcafe13471c71c1403f5beb9771c` | `.ic{background-image:url(...)}` in the `<helmet><style>` |
| `data.json` | `89ac55d62aee0ea0f649a8a5a56833c3` | `DATA_URL` at the top of the script |

If you do not regenerate the content, skip this step: the uploads are durable. The render and check scripts read both ids from the page, so a new upload needs no other change.

### 3. Edit, check, render, republish

Edit the repo copy `artifact/project/Main.dc.html`. The Design type's runtime is saved from the artifact (`Artifact` `action: "read"`, `url`, `paths: ["artifact-type/dc-runtime.js"]`); pass the saved path as `--runtime`.

```sh
# every claim of every toggle, as assertions (about two minutes); --only "<text in a check name>" for one, --verbose for call logs
node initiatives/visual-refinement/check-artifact.mjs $V/assets --runtime <dc-runtime.js> [--shots <dir>] [--only ...]
# a picture of a state (clicks only; hover states are in the check script)
node initiatives/visual-refinement/render-artifact.mjs $V/assets $V/shots --runtime <dc-runtime.js> --crop frame \
  --shots "base=;all=All changes on;cover=Fold 8 cover,All changes on"
```

[render-artifact.mjs](render-artifact.mjs) serves the artboard locally with `support.js` = the runtime and the two `/_blob/` ids mapped to the files in `<assets-dir>`. `--shots` takes `name=Label,Label;name2=...`: each label is a button clicked in order (substring match; a leading `=` means the whole accessible name). `--crop frame` screenshots only the replica.

Then publish:

```
Artifact  url: https://claude.ai/artifact/N8pwXR8kxgrzJpqh7wirDK
          root: <absolute path of initiatives/visual-refinement/artifact>
          file_path: <root>/project/Main.dc.html     (send canvas.json only when boards, notes or the title change)
```

If a publish is refused because someone edited in the page, read the artifact (`action: "read"`, `path: "project/Main.dc.html"`) and merge.

### Format rules that bit (Design `.dc.html`)

- `{{hole}}` is a dotted lookup only, never an expression. Compute everything in `renderVals()`; style strings are built in script and bound whole. A hole inside an SVG `d` attribute logs a parse error in the console (the browser sees `{{...}}` before the binding): use static paths with `sc-if`.
- Events are `onClick="{{fn}}"`, `onMouseEnter`, `onMouseLeave` with `fn` returned from `renderVals()`; per-item handlers are attached to each loop item (an outer loop variable such as `r.pick` is reachable from a nested loop). Real `<button>` elements, never `onClick` on a div. A full-screen invisible `<button>` is the backdrop trick; a row-sized `.rowhit` button behind pointer-transparent cells makes the whole row clickable.
- Inline styles beat class rules: anything a `:hover` rule must change cannot also be set inline (the original `hideEmpty` bug: inline `opacity:0` against `.row:hover .ph{opacity:1}`).
- `<sc-for>` and `<sc-if>` only (no else). All UI is markup in the template, never built from script. Every list item must carry every flag the template tests.
- `this.state` can be undefined on the first `renderVals()`: merge with `INIT`. `componentDidMount`, `componentDidUpdate` and `componentWillUnmount` work; the page uses them for Escape, the tab strip's scroll position and scrolling the selected row into view.
- Keep the `<script src="./support.js">` head line exactly. No imports, no network except the uploaded `/_blob/...` urls.
- Do not render or open the artifact on claude.ai unless the owner asks; the local render above is the check.

## The layout model

All sizes are computed in `lay()` and used both to draw and to fill the readout, so what is counted is what is drawn. Calibrated on the baseline screenshots (1440 × 900, Metals):

| Piece | Model |
|---|---|
| Above the table | 44 (top bar) + 9 + summary + 9; summary = tallest pane = 32 header + grid + 110 detail + 1 |
| Summary grid | 97 px max, 67 px min (empty or sparse); slot 50 × 52, 4 px gap, `floor((paneW - 12) / 54)` per row; paneW = `(vw - 40) / 3`; under 768 px 85% of the width, 330 px at most, panes scroll sideways |
| Columns | grip 32, recipe min 150 (weight 3), machine 88, beacons 88, products 72, byproducts min 80 (weight 2), ingredients min 148 (weight 4), power 72; extra width split 3 : 2 : 4. With `narrowStack` under 768 px Machine and Beacons are 0 and the minimum is 554 |
| Area rows | name spans recipe + machine + beacons; chips span products + byproducts (+ 28 px borrowed so the `+N` stays on the line); the app's cap is 8 sent and 16 received, wrapped at 33 px per line; `grpFixed` keeps one line |
| Recipe rows | 37 px, plus one chip slot per extra wrapped line, plus 36 px when machine chips stack under the name |
| Chip | 28 px icon, 34 px slot (32 and 38 with `chipBig`); quantity 9 px mono bottom-right |
| Rows visible | cumulative fit in `vh - above - 44 (toolbar) - 26 (header) - sheet height`, plus the fraction of the last row; opened groups count |
| Top bar | tabs `clamp(96, 58 + 6.4 × chars, 176)` wide, 4 px apart, 32 px high on a 44 px bar; right side 8 + All blocks (22, or 34) + `+` 28 + 16 + four tools (32 each, wider with labels) + divider + workspace (136, 132 lighter, 62 under 768) + 8; the strip is centred on the active tab; "cut" counts tabs not fully visible |
| Side panel | docked 380 px from 1280 px (table gets `vw - 380`); drawer 380 px (full width under 640 px) over the table; sheet = min(content, 45% of height) |
| Gap | mean over rows with products and ingredients of (first ingredient chip x) - (last product or byproduct chip x); ingredients are right-aligned |

Checked values (baseline): Metals 1440 × 900 gives 302 px above the table (asserted by the check script); Hub rows are 66 px (two lines of receives), Metals area rows 33 px.

## Thoughts and judgement calls

- Subagents were considered and judged not worth it for the build: the page is one file whose toggles all touch the same layout. A fresh agent comparing the render against the screenshots would still be useful.
- The owner asked to read values from the save rather than the screenshots, and to build on `scripts/inspect-plan.mjs`; no other initiative has a solver script.
- Finding 11 is not a toggle; it is why the readout tracks rows visible.
- **Legend options for the selected item (all on the shared bar, 72 px works with each; the owner is trying them):** `legTip` (black tooltip on hover or focus of a bar segment; the key line goes, actions keep their line), `legInBar` (16 px bar with the text inside: name and amount, amount alone, or nothing by segment width; native title as fallback), `ovBar` turns the overview rows into one stacked bar sized by share (hover/click traces, same legend options apply; item count rides along as "381 · 14" when it fits; without a legend option a key line sits under the bar). Known weakness: a narrow segment (about 12%) shows its amount only, so only colour, the tooltip or the native title name it. `render-artifact.mjs` accepts `slot:N` and `seg:N` labels (a name like "Iron sheet coil" would hit the table row first).
- Decisions this session that the owner may want to change: `colCap` applies only with the side panel closed (docked, the table keeps its width); `colTrail` wins over `colRecipe`; `sumShort` puts the colour key and the actions on one line (that is what makes 72 px fit; the overview then shows about one row, the real cost); `hideEmpty` leaves the placeholders visible on the four touch screens; `sumStack` (owner's request: phones should stack the three panes, but only the collapsed summary; from the Fold inner screen on keep columns): needs `sumLine`; under 768 px the three collapsed lines are 34 px each on top of each other, the handle row carries Expand/Collapse in both states, and the expanded summary keeps the sideways-scrolling panes (a stacked expanded strip would be about 720 px, more than the cover's 657). `sumLine` is now a persistent collapse/expand toggle (owner's idea: connection work is done in batches, an overlay needs a click every time): the chips shown are those that fit (24 px, 30 px slots) then a `+N` that opens the list of all items with rates (click here, hover in the app, same as the area rows; the list is informational, not clickable per item); the Expand button sticks to the right edge when the panes scroll on narrow screens; the choice survives block switches but is not stored across reloads, and expanding pushes the table; the one-line summary drops its chips under 768 px and scrolls; the `+N` popup opens on click in the replica, on hover in the app.
- Answered by the owner (2026-11-08): `legTip` and `legInBar` combine (text inside the bar when it fits, tooltip always available); the `sumLine` collapsed state survives a reload in the app. The compact-tab tooltip (`tabsFit`) also shows on keyboard focus (owner, 2026-11-08); the replica does not do that yet.
- Rough expectations to compare with the readout: `sumShort` about 264 px above the table (38 less); `sumLine` about 200 px collapsed (starts collapsed when switched on), about 18 px more than the baseline expanded (the collapse handle); `chipBig` +4 px per row; `grpFixed` removes the 66 px rows; `colRecipe`, `colTrail` or `colCap` should bring the gap under 300 px at 1920; `narrowStack` should bring Products and part of Ingredients into view on the 416 px cover; `panSheet` keeps 100% of the row columns in view where the drawer hides most of them.

## Next steps

1. Ask the owner to open the artifact, use the toggles (each says what to try), and say what looks wrong or which to accept. 
2. Fix what they report. Likely candidates: the model constants, popover positions near the frame's edges, the `sumShort` layout.
3. Record accept / reject / tweak per finding in plan.md. Then follow its "After the artifact" section: backlog items or a follow-up plan, update `spec/ui.md` when changes ship, trim `baseline/` (2.3 MB), and `git mv` this folder to `initiatives/archive/`.
4. Not covered yet: pickers and modals, the block graph with 11 blocks, a light theme, the Nullius data set, areas inside areas.

## Gotchas

- macOS `sed -i` needs `sed -i ''`.
- `sharp` has no `lib/index.js` in this install: import `node_modules/sharp/dist/index.mjs` (the scripts already do).
- Vite's `ssrLoadModule` needs `root` set to the repo; the scripts compute it from their own location, so run them from anywhere. The extractor also loads `ItemTile.tsx` and the summary modules this way.
- In the check script, `.rowhit` sits behind chips that select their row: use `click({ force: true })` for a click at the row's centre, or a position on an empty part of the row. Toggles are found by their title text; a button's accessible name includes its description and Try line, so a short label matches the wrong button.
- `--shots` entries in `render-artifact.mjs` split on the first `=` only.
- The artifact's content comes from the owner's personal save; it is not in the repo. The sprite and data are uploaded to the private artifact only.
