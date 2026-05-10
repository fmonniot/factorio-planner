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

- [x] **Power display:** Show power values in Watts/kW/MW instead of the current "Value/sec" format. Tooltip already shows kW, so the data is available.

---

## Localisation

- [ ] **Missing English locale:** `nullius-saline-electrolysis` is still displayed with its internal ID instead of its English name. Trace and fix the locale lookup for this recipe.
