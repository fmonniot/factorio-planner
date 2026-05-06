# Roadmap

Time-bound view of what has shipped, what's active, and what's deferred. For
the timeless system specification, see [../spec/](../spec/).

Status markers: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Shipped

| Phase / initiative | Summary |
|---|---|
| Phase 0 — Ground truth | Lua export, Nullius sample data, data analysis, 6-case test corpus. See [../spec/data-analysis.md](../spec/data-analysis.md), [../spec/test-corpus.md](../spec/test-corpus.md). |
| Phase 1 — Project scaffold | Vite + React 19 + Tailwind v4 + Vitest. Zod schemas, loader (29 unit tests). |
| Phase 2 — Solver | Stoichiometry, reduction, LU + pseudo-inverse, pinned rates, modules/beacons, entry point. All 6 corpus cases. See [../spec/solver.md](../spec/solver.md). |
| Phase 3 — State and data loading | Plan store with undo/redo, game-data store, debounced solver subscription, localStorage persistence. |
| Phase 4 — UI core | App shell, item picker, goals panel, recipe card, tree view, summary bar (subsequently replaced by the UI redesign). |
| Phase 5 — UI editing | Machine selector, alternate recipes, modules, beacons, rate pinning, byproduct policy, table view (subsequently replaced by the UI redesign). |
| LP solver v2 | Linear-programming solver migration. Tasks 1–12 done; task 13 (delete v1) gated on real-data validation. See [archive/lp-solver/](archive/lp-solver/). |
| Factory-Planner UI redesign | Flat dense table, inline expand/collapse, Factorio-style recipe and item pickers (T01–T15). See [archive/ui-redesign/plan.md](archive/ui-redesign/plan.md). |

---

## Active

### Visual parity (V01–V09)

Bring the shipped UI to visual parity with the Factory Planner mod target.
Tickets in [visual-parity/tickets.md](visual-parity/tickets.md).

- [ ] V01 Recipe column shows recipe icon; pin/wrap move left of icon
- [ ] V02 Machine cell: icon + count + module-slot dots
- [ ] V03 Beacon cell: icon-style add button
- [ ] V04 Power inline as electricity tile
- [ ] V05 Editable block name + summary box card chrome
- [ ] V06 Drop the "Production" table heading
- [ ] V07 BlockTabs share a row with the game-data picker
- [ ] V08 Merge BalancedItemsFooter and warning indicator
- [ ] V09 Tile chrome and table density polish
- [x] V10 Recipe / item picker redesign (shipped via T15)

### Phase 6 — Import / Export / Sharing

- [ ] **6.1 Export plan as JSON**
- [ ] **6.2 Import plan from JSON**
- [ ] **6.3 Share plan via URL** (compressed base64 query param, with size warning)
- [ ] **6.4 Import game data JSON** (custom mod bundle)
- [ ] **6.5 Settings panel** (default machines, rate unit, game data info)

### Phase 7 — Icons and Polish

- [ ] **7.1 Icon pipeline**
  Build-time script to extract item icons from game files and assemble a sprite sheet. Update recipe cards and item picker to show icons.
- [ ] **7.2 Solver warnings in UI**
  Surface `SolverWarning` entries on affected recipe cards (cycle, underdetermined, no-recipe).
- [ ] **7.3 Rate-changed animation**
  Briefly highlight cards whose computed rate changed from the previous solve (feed-back side-effect visibility).
- [ ] **7.4 Responsive layout**
  Collapsed sidebar, compact summary bar, single-column card list for small screens.
- [ ] **7.5 Keyboard navigation**
  Item picker keyboard nav, common shortcuts (add goal, undo/redo).

---

## Pending design

- [edit-machine-modal/](edit-machine-modal/) — unify machine + module popovers into a single modal.
- [edit-beacon-modal/](edit-beacon-modal/) — beacon cell refactor and modal editor (blocked on game-data export).

---

## Open TODOs

**Solver integration test.** Add a `src/solver/index.integration.test.ts` that runs the
full solver against the real Nullius `data/samples/nullius/game-data.json` export
(gate with `skipIf(!sampleExists)`). Exercise corpus-like goals on real recipe/machine
data to catch regressions that synthetic unit tests cannot: missing machine for a
category, unexpected item classifications, real craftingSpeed values affecting machine
counts.

---

## Deferred (post-v1)

- Optimization mode (minimize machines/power via LP)
- Sankey / flow diagram view
- Mining/extraction machine modelling
- Quality tier support
- Multi-factory / sub-factory splitting
- Plan diffing
- Recipe card grouping (manual folders or auto-group by tier)
- Drag-and-drop goal ordering
- Dark mode
- Vanilla Factorio support
- Additional mod support (tested and bundled datasets)
- In-app Lua script runner to export data directly from a game installation
- Named plan links (server-side short URLs)
- Read-only plan view for sharing without editing
