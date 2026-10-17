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

- [ ] **Rename sub-blocks:** A sub-block's name cannot currently be edited.

## Bugs

- [ ] **Game selector doesn't switch game state:** Switching game with the top-right selector does not switch the plan/state with it, so the new game set shows "unknown recipe" errors. Each game (modset) should carry its own state, which would also allow several modsets to coexist side by side.

- [ ] **Can't make water from a pump:** Offshore pumps (and similar fluid sources) are not usable as a recipe/producer for water, so water cannot be "made" in a plan.

## Features

- [ ] **Connections between blocks:** Support explicit connections between blocks (e.g. one block's output feeding another block's input).

- [ ] **Plan horizon:** Filter which technologies/recipes are available while planning, so the player decides how far ahead they plan (e.g. hide space-science-gated recipes while planning the first science packs).

## Docs / project management

- [x] **Usage README:** Write a README covering how to use the planner.

- [ ] **Review project management:** Double-check the current setup (`spec/`, `initiatives/`, `TODO.md`, `AGENTS.md`) and consider an overhaul based on what has been learned since it was put in place.
