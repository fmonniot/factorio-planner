# Machine + Module cells → unified "Edit machine" modal

## Context

Today the production table edits the machine and module configuration through two
separate popovers triggered from two adjacent cells of [RecipeRow.tsx](../../src/components/factory/RecipeRow.tsx#L182-L201):

- [MachineCell](../../src/components/factory/MachinePopover.tsx#L108-L152): shows
  `2x <icon> <name>` and opens [MachinePopover](../../src/components/factory/MachinePopover.tsx#L16-L93)
  (machine selection only, no count input).
- [ModuleCell](../../src/components/factory/ModulePopover.tsx): shows `[used/slots]` text and opens a popover
  with per-module +/- buttons.

The user wants to align with the Factory Planner mod's "Edit machine" modal
(reference image at <https://assets-mod.factorio.com/assets/6234eeb6329ba902104c02d61f6c4e5a9a508a8b.png>):

- Compact, icon-only trigger cells: machine icon with count overlaid in the
  bottom-right; module icon (first module of the row) with count overlaid the
  same way. The "first module is the icon when multiple are used" rule mirrors
  the source UI.
- A single shared modal opens from either icon and configures both at once.

## Reference modal — adapted ASCII for this project

The source modal contains several Factorio-mod-specific concepts that don't
map onto our data model and are therefore dropped:

- **Fuel** — no fuel selection in our model. `MachineSchema` does carry
  `energyType: 'electric' | 'burner' | 'heat' | 'void'`, so non-electric
  machines (burner drills, stone furnaces, etc.) exist in the data but the
  solver and UI currently ignore fuel-item choice and burner energy is folded
  into the same `energyUsageKw` figure. Dropping the Fuel section now is a
  known trade-off: we will need to revisit this section when fuel-item
  selection becomes a first-class feature (separate ticket — affects schema,
  solver power accounting, and this modal).
- **Limit / Exact limit** — we already model machine count via solver +
  `pinnedRate`; no separate "limit" concept.
- **Quality column under Recipe effects** — recipes carry `allowProductivity`
  but no quality field; modules expose `effects.quality` but it's not
  consumed by the solver today. Show it only if the active machine + recipe
  actually allow it (otherwise hide the row).
- **Defaults bookmarks** — no preset system in the codebase.
- **Submit button** — every other editor in this app auto-applies on change
  (see all *Popover.tsx files); the modal should follow that convention with
  a single `Close` action, not Cancel/Submit.

```
┌─ Edit machine ─────────────────────────────────────── [↺] [✕] ─┐
│  Configure the machine for 'Advanced circuit'                   │
├──────────────────────────────────────────────────────────────────┤
│  Machine                                                          │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ [⚙icon] Assembling machine 3   ▾   ×2 machines          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  Modules  (2 / 4 slots used)                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  [+icon] Productivity 3   ───●─────────────  [ 2 ] /4   │   │
│  │  [+icon] Speed 3          ●─────────────────  [ 0 ] /4   │   │
│  │  [+]  add module…                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌─ Machine effects ──────────┐  ┌─ Recipe effects ───────────┐ │
│  │ Speed:        +50%         │  │ Speed:        +50%         │ │
│  │ Productivity: +20%         │  │ Productivity: +20%         │ │
│  │ Energy use:   +60%         │  │ Energy use:   +60%         │ │
│  │ Pollution:    +60%         │  │ (Quality row hidden – n/a) │ │
│  └────────────────────────────┘  └────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────┤
│                                                       [ Close ]  │
└──────────────────────────────────────────────────────────────────┘
```

Notes on the two effects boxes:

- **Machine effects** — totals from modules only (sum of `effects.{speed,
  productivity, consumption, pollution}` × count across all module slots).
- **Recipe effects** — same totals but filtered through `recipe.allowProductivity`
  (productivity zeroed when false) and `machine.allowedEffects` (zero anything
  the machine itself doesn't allow). This mirrors the source UI's split between
  raw-module bonus and what actually applies on this recipe.
- Beacon is **out of scope** for this modal (still a separate cell). The source
  modal has no beacon section either.

## Compact cell triggers (ASCII)

```
machine cell                module cell  (first module shown)
┌────────┐                   ┌────────┐
│ ⚙icon  │                   │ +icon  │
│      2x│   click ──┐  ┌──  │      4x│
└────────┘           ▼  ▼    └────────┘
              opens the same modal
```

- Both cells render a 28×28 icon button with a count badge in the bottom-right
  (white text, 10px, drop-shadow for legibility — same pattern as
  `ItemTile`'s rate text but absolutely positioned).
- Machine count = `solvedNode.machineCountCeil` (read-only, derived).
- Module count = sum of `modules[*].count` (the total slots used). The icon
  source = `modules[0]?.moduleId`, with a generic placeholder when the row
  has no modules yet.
- Empty state: machine cell shows a faded "no machine" placeholder; module
  cell shows a faded `+` placeholder. Both still open the modal.

## File-level plan

### New
- `src/components/factory/EditMachineModal.tsx` — the modal. Composes:
  - **Machine row**: a button that toggles inline a compact picker reusing the
    list logic currently in `MachinePopover.tsx:16-93`. Shows count read-only.
  - **Modules section**: per-slot rows with module icon, name, count input
    (reusing the +/- logic in `ModulePopover.tsx:104-118`),
    plus an "add module" picker. Capped at `machine.moduleSlots`.
  - **Effects panels**: pure derivation from modules + machine + recipe.
    Pull `recipe.allowProductivity` and `machine.allowedEffects` from
    `schema.ts:56-98`.
- `src/components/Modal.tsx` — small modal primitive
  (backdrop, centered card, Esc-to-close, focus trap). Tailwind only;
  similar contract to existing `Popover.tsx`.
  Shared because no Modal/Dialog exists today.

### Modified
- `src/components/factory/MachinePopover.tsx` — repurpose:
  - Replace `MachineCell` body with the new icon+badge button. Keep its
    public props identical so `RecipeRow.tsx:184-191` stays unchanged.
  - `MachineCell` now calls `onOpenEdit` instead of opening a local popover.
- `src/components/factory/ModulePopover.tsx` — same treatment:
  - Replace `ModuleCell` body with the new icon+badge button.
  - `ModuleCell` now calls `onOpenEdit` instead of opening a local popover.
- `src/components/factory/RecipeRow.tsx`:
  - Owns `editMachineOpen` state.
  - Renders `<EditMachineModal ... />` once, conditional on `editMachineOpen`.
  - Passes `onOpenEdit={() => setEditMachineOpen(true)}` to both cells.

### Untouched
- `BeaconPopover.tsx` — beacon stays in its own cell.
- `blockStore.ts` — every mutation we need (`updateNodeMachine`, `updateNodeModules`) already exists.
- `iconUrl.ts` — unchanged; the count badge is a positioned `<span>` next to the `<img>`, not a composed image.

## Verification

- **Unit**: `npm run test:unit` — extend `RecipeRow.test.tsx` with:
  1. Machine cell renders icon + count badge (no `2x` prefix anymore).
  2. Module cell renders first module's icon + total-count badge.
  3. Clicking either cell opens the modal; the modal mounts once.
  4. Inside the modal, changing machine selection calls `updateNodeMachine`.
  5. Inside the modal, +/- on a module slot calls `updateNodeModules`.
  6. Effects panel computes the right totals for a fixture.
  7. Recipe-effects panel zeroes productivity when `recipe.allowProductivity === false`.
- **E2E**: `npm run test:e2e` — update locators from old text-based MachineCell/ModuleCell selectors to new icon-button title attributes.
- **Manual**: `npm run dev`:
  - Open a recipe row, click the machine icon → modal opens.
  - Change machine → row recomputes, modal stays open with new effects.
  - Add productivity-3 modules → effects panel updates live.
  - Click the module icon → same modal opens.
  - Esc and the Close button both dismiss the modal.

## Out of scope

- Fuel-item selection for burner machines (deferred — see trade-off note
  above; revisit when fuel becomes a modeled axis).
- Exact-limit toggle, defaults/bookmarks (no data model).
- Beacon configuration in the same modal (kept as separate cell for now).
- Drag-to-reorder modules within slots (no current need).
