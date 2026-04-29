# Tasks

## DX / AI Workflow

- [ ] Configure Claude Code hooks (or CLAUDE.md guidance) to auto-update spec files after any source change, so specs serve as always-current documentation without requiring full codebase traversal each session.

---

## UI / UX

- [ ] **Module & machine labels:** Display human-readable names instead of internal IDs in the module and machine selectors. Investigate whether this requires pulling in the localisation layer.


- [ ] **Beacon UI overhaul:**
  - [x] Replace the current beacon UI with one dropdown per module slot so users can assign different module types per slot.
  - [x] Fix the UI-reset bug that also affects the module selector.
  - [ ] Support multiple beacon types per machine.
  - [ ] Enforce module restrictions (e.g. productivity modules cannot go into Nullius beacons — verify in-game before implementing).

- [ ] **Warning vs. error distinction:** Split the warning panel into two categories — *warnings* (suggestions the solver can ignore) and *errors* (conditions that prevent the plan from resolving) — and surface them with different visual treatment.

- [ ] **Remove-recipe action:** Add a way to remove a recipe from the plan in the current UI (the action is missing entirely).

- [ ] **Power display:** Show power values in Watts/kW/MW instead of the current "Value/sec" format. Tooltip already shows kW, so the data is available.

- [ ] **UI redesign (in progress):** Rework the overall UI using [helmod](https://mods.factorio.com/mod/helmod) and [Factory Planner](https://mods.factorio.com/mod/factoryplanner) as visual references.

---

## Localisation

- [ ] **Missing English locale:** `nullius-saline-electrolysis` is still displayed with its internal ID instead of its English name. Trace and fix the locale lookup for this recipe.
