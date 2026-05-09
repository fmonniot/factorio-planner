# Tasks

Inbox of small items that don't warrant a full initiative folder under
[initiatives/](initiatives/). Larger work belongs in
[initiatives/roadmap.md](initiatives/roadmap.md); the UI redesign tracked here
is now covered by [initiatives/visual-parity/tickets.md](initiatives/visual-parity/tickets.md).

## UI / UX

- [ ] **Module & machine labels:** Display human-readable names instead of internal IDs in the module and machine selectors. Investigate whether this requires pulling in the localisation layer.

- [ ] **Beacon UI overhaul:**
  - [ ] Support multiple beacon types per machine.
  - [ ] Enforce module restrictions (e.g. productivity modules cannot go into Nullius beacons — verify in-game before implementing).

- [ ] `BalancedItemsFooter` and warnings
  - [ ] **Warning vs. error distinction:** Split the warning panel into two categories — *warnings* (suggestions the solver can ignore) and *errors* (conditions that prevent the plan from resolving) — and surface them with different visual treatment.
  - [ ] Duplicate recipe show up without a good reason to? Export plan to figure out why that is.
  - [ ] biggest question around whether we actually need the bar at all? balanced items doesn't seems to make much sense nowadays, we offer enough tools for the user to solve issues with a plan without having to know there is a specific error/warning? Or maybe it's still useful? Maybe just as a console log?

- [ ] **Remove-recipe action:** Add a way to remove a recipe from the plan in the current UI (the action is missing entirely).

- [ ] **Power display:** Show power values in Watts/kW/MW instead of the current "Value/sec" format. Tooltip already shows kW, so the data is available.

- [ ] **Subgroup improvements:**
  - [ ] When clicking on the ingredient of a recipe in a sub group, the added recipe should be added to said subgroup
  - [ ] It should be possible to move recipes between the main group and a sub group, or between sub groups. Drag'n'drop sounds like a good way to do that.


---

## Localisation

- [ ] **Missing English locale:** `nullius-saline-electrolysis` is still displayed with its internal ID instead of its English name. Trace and fix the locale lookup for this recipe.
