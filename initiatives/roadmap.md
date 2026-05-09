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
| Phase 2 — Solver (initial) | Stoichiometry, reduction, LU + pseudo-inverse, pinned rates, modules/beacons. Subsequently replaced by the LP solver migration. |
| Phase 3 — State and data loading | Plan store with undo/redo, game-data store, debounced solver subscription, localStorage persistence. |
| Phase 4 — UI core (legacy) | App shell, item picker, goals panel, recipe card, tree view, summary bar — replaced by the UI redesign. |
| Phase 5 — UI editing (legacy) | Machine selector, alternate recipes, modules, beacons, rate pinning, byproduct policy, table view — replaced by the UI redesign. |
| LP solver v2 | Replaces the LU + pseudo-inverse solver with `javascript-lp-solver`. Tasks 1–12 done; v1 retired and v2 flattened back into `src/solver/`. See [archive/lp-solver/](archive/lp-solver/). |
| Factory-Planner UI redesign | Flat dense table, inline expand/collapse, Factorio-style recipe and item pickers (T01–T15). See [archive/ui-redesign/plan.md](archive/ui-redesign/plan.md). |
| Visual parity (V01–V10) | Recipe icon, machine/beacon icon-and-badge cells, inline electricity tile, editable block name, single-row top bar, merged status footer, tile chrome polish. See [archive/visual-parity/tickets.md](archive/visual-parity/tickets.md). |
| Edit Machine modal | Unified machine + module configuration in a single modal with effects panels. See [archive/edit-machine-modal/design.md](archive/edit-machine-modal/design.md). |
| Edit Beacon modal | Beacon cell refactored to icon+badge trigger; full BeaconModal with beacon-type picker. Game-data exporter updated to populate `beacons` collection. See [archive/edit-beacon-modal/](archive/edit-beacon-modal/). |

---

## Active

No active initiative folders. The remaining sequenced work is below.

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

## Open TODOs

**Solver integration test.** Add a `src/solver/index.integration.test.ts` that runs the
full solver against the real Nullius `public/data/nullius/game-data.json` export
(gate with `skipIf(!sampleExists)`). Exercise corpus-like goals on real recipe/machine
data to catch regressions that synthetic unit tests cannot: missing machine for a
category, unexpected item classifications, real craftingSpeed values affecting machine
counts.

---

## Deferred (post-v1)

- Optimization mode (minimize machines/power via LP cost function)
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
