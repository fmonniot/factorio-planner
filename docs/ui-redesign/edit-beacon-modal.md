# Beacon cell → icon+badge trigger + BeaconModal

## Context

Today `BeaconCell` shows a plain `×4` text button (or `+` when no beacon is
configured) that opens a compact `BeaconPopover` with a dropdown + numeric
inputs. This is inconsistent with the new `MachineCell` / `ModuleCell` style
(icon+badge, modal). The reference UI is the Factory Planner mod's own
"Edit beacon" dialog ([docs/ui-redesign/Screenshot 2026-04-27 at 20.56.04.png](../docs/ui-redesign/Screenshot%202026-04-27%20at%2020.56.04.png)).

---

## What the reference modal shows

```
┌─ Edit beacon ─────────────────────────────── [↺] ──┐
│  Configure the beacon for 'Distillery 2'            │
├─────────────────────────────────────────────────────┤
│  Beacon  [🔆 icon]  Amount [ 7 ]  × 1   Total [7]  │  ← beacon type + count
│─────────────────────────────────────────────────────│
│  ┌─ Beacon effects ──┐  ┌─ Recipe effects ────────┐ │
│  │ Speed:  +70%      │  │ Speed:       +70%       │ │
│  │                   │  │ Productivity: +8%       │ │
│  └───────────────────┘  └─────────────────────────┘ │
│─────────────────────────────────────────────────────│
│  Module  [📡 icon]  Amount  ─────●───  [ 1 ]        │  ← module + count
│─────────────────────────────────────────────────────│
│  Defaults   Beacon & Modules ⓘ  [🔖] [≡]            │
├─────────────────────────────────────────────────────┤
│  [ Cancel ]       [ Delete ]         [ Submit ]     │
└─────────────────────────────────────────────────────┘
  Beacon icon = clickable → picks which beacon building to use
  Amount = beaconCount
  × N   = the beacon type's module-slot capacity (fixed by type, read-only)
  Total = beaconCount × modulesPerBeacon
  Module slider = modulesPerBeacon (0 … beacon type's slot cap)
```

---

## Schema changes required

Beacon items exist in `gameData.items` but only carry `{id, name, iconPath,
hidden, stackSize}` — no `moduleSlots` or `distributionEfficiency`. We need a
first-class `beacons` collection and a `beaconId` on `BeaconConfig`.

### `src/data/schema.ts` additions

```ts
export const BeaconEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  iconPath: z.string(),
  hidden: z.boolean().default(false),
  moduleSlots: z.number().int().nonnegative(),
  distributionEfficiency: z.number().min(0).max(1),
  allowedEffects: z.array(EffectNameSchema),
})
// Add to GameDataSchema:
//   beacons: z.record(z.string(), BeaconEntitySchema).default({})
```

`BeaconConfigSchema` gains an optional `beaconId`:

```ts
export const BeaconConfigSchema = z.object({
  beaconId: z.string().optional(),          // ← new
  moduleId: z.string(),
  beaconCount: z.number().int().nonneg(),
  modulesPerBeacon: z.number().int().positive(),       // kept for backward-compat
  distributionEfficiency: z.number().min(0).max(1),   // kept for backward-compat
})
```

When a beacon type is selected in the modal, `modulesPerBeacon` and
`distributionEfficiency` are **auto-populated** from
`gameData.beacons[beaconId]` and written back into `BeaconConfig`. The solver
continues to use `beacon.modulesPerBeacon` and `beacon.distributionEfficiency`
unchanged — no solver edits needed.

> **Note:** The game-data exporter (Lua side, external to this repo) needs a
> matching update to populate the `beacons` collection. Until then
> `gameData.beacons` defaults to `{}` (the schema `.default({})` ensures
> existing data files still parse). The UI degrades gracefully: if the
> collection is empty, the beacon-type picker shows a "no beacon data" notice.

---

## Adapted layout for this project

Items dropped from the source UI:

| Source | Reason dropped |
|---|---|
| `× N` slot-cap display | Shown implicitly via beacon type selection |
| Total display | User said not necessary |
| Module amount slider | Replaced by plain number input `modulesPerBeacon` (only shown when no beacon-type data, i.e. legacy mode) |
| Defaults / bookmarks | No preset system |
| Submit / Cancel / Delete | Auto-apply + Close; Delete → "Remove beacon" |

```
┌─ Edit beacon ──────────────────────────────── [✕] ─┐
│  Configure the beacon for 'Advanced circuit'        │
├─────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────┐  │
│  │  Beacon  [🔆 icon ▾]  Beacon name             │  │
│  │          Amount  [ 4 ]                        │  │
│  └───────────────────────────────────────────────┘  │
│  ┌─ Beacon effects ──────┐  ┌─ Recipe effects ────┐ │
│  │  Speed:  +50%         │  │  Speed:  +50%       │ │
│  └───────────────────────┘  └─────────────────────┘ │
│  ┌───────────────────────────────────────────────┐  │
│  │  Module  [📡 icon ▾]  Module name             │  │
│  └───────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│  [ Remove beacon ]                    [ Close ]     │
└─────────────────────────────────────────────────────┘

  [🔆 icon ▾] = clickable, expands beacon-type picker below it
  [📡 icon ▾] = clickable, expands module picker below it
  Amount      = beaconCount (free integer ≥ 0)
  Effects     = beaconCount × moduleSlots × distributionEfficiency × module.effects[key]
               (moduleSlots and distributionEfficiency from selected beacon type)

  Legacy mode (gameData.beacons empty — no beacon-type data):
  ┌───────────────────────────────────────────────┐
  │  Beacon  [no data]  Amount  [ 4 ]             │
  │  Modules/beacon     [ 2 ]    ← modulesPerBeacon│
  │  Efficiency         [ 0.50 ] ← distributionEfficiency │
  └───────────────────────────────────────────────┘
  Both extra inputs are shown only when gameData.beacons is empty.
```

### Beacon-type picker (click icon to expand, same pattern as machine picker in EditMachineModal)

```
  [🔆 icon ▾]  "Small beacon 3"

  ┌────────────────────────────────────────────┐
  │  [🔆] Small beacon 1                       │
  │  [🔆] Small beacon 2                       │
  │  [🔆] Small beacon 3  ← active (teal)      │
  │  [🔆] Large beacon 1                       │
  │  [🔆] Large beacon 2                       │
  └────────────────────────────────────────────┘
  (flat list sorted by name; hidden beacons excluded)
```

### Module picker (click icon to expand, flat list like machine picker)

```
  [📡 icon ▾]  "Speed module 3"

  ┌────────────────────────────────────────────┐
  │  [⚡] Speed module                          │
  │  [⚡] Speed module 2                        │
  │  [⚡] Speed module 3  ← active (teal)       │
  │  [🌿] Efficiency module                     │
  │  ...  (all non-hidden modules)              │
  └────────────────────────────────────────────┘
```

### BeaconCell trigger (current → new)

```
  current          beacon configured           no beacon
  ×4               ┌──────┐                   ┌──────┐
  (text)           │  🔆  │                   │      │
                   │   4× │  beaconCount badge │   +  │  faded placeholder
                   └──────┘                   └──────┘
  icon = beacon type's icon (or module icon if no beacon type selected yet)
```

---

## Effects computation

```
effectiveSlots      = gameData.beacons[beaconId]?.moduleSlots      ?? beacon.modulesPerBeacon
effectiveEfficiency = gameData.beacons[beaconId]?.distributionEfficiency ?? beacon.distributionEfficiency

beaconEffects[key]  = beaconCount × effectiveSlots × effectiveEfficiency × module.effects[key]
```

**Beacon effects** panel — raw beacon totals (no recipe filtering).

**Recipe effects** panel — same totals filtered through `recipe.allowProductivity`
and `machine.allowedEffects`, using `applyRecipeConstraints` from
`EditMachineModal.tsx` (export it first).

---

## File-level plan

### Modified: `src/data/schema.ts`
- Add `BeaconEntitySchema` (id, name, iconPath, hidden, moduleSlots,
  distributionEfficiency, allowedEffects).
- Add `beacons: z.record(...BeaconEntitySchema).default({})` to `GameDataSchema`.
- Add `beaconId: z.string().optional()` to `BeaconConfigSchema`.
- Export new types: `BeaconEntity`.

### New: `src/components/factory/BeaconModal.tsx`
Full beacon editor. Uses `Modal` from `src/components/Modal.tsx`. Sections:
1. **Beacon row** — beacon-type icon button (click → inline flat picker listing
   `gameData.beacons` values sorted by name; shows "no beacon data" when empty),
   beacon name, `beaconCount` number input.
2. **Effects panels** — import `EffectsPanel` and `applyRecipeConstraints` from
   `EditMachineModal.tsx` (export them first). Derives raw and filtered totals.
3. **Module row** — module icon button (click → inline flat picker listing all
   non-hidden modules sorted by name), module name.
4. **Footer** — "Remove beacon" (`updateNodeBeacon(nodeId, undefined)` + close)
   and "Close".

When a beacon type is selected:
```ts
const beaconEntity = gameData.beacons[newBeaconId]
updateNodeBeacon(nodeId, {
  ...beacon,
  beaconId: newBeaconId,
  modulesPerBeacon: beaconEntity.moduleSlots,
  distributionEfficiency: beaconEntity.distributionEfficiency,
})
```

### Modified: `src/components/factory/BeaconPopover.tsx`
- Replace `BeaconCell` body with icon+badge button (beacon-type or module icon +
  `beaconCount` badge, or faded `+` placeholder).
- `BeaconCell` owns `open` state and renders `<BeaconModal>` (no lift into
  RecipeRow needed).
- Default `BeaconConfig` on first "enable": pick first non-hidden beacon from
  `gameData.beacons`, else keep old defaults; pick first module by name.
- Delete `BeaconPopover` component.
- Props interface **unchanged** (`nodeId`, `beacon`, `gameData`) so `RecipeRow.tsx`
  needs no edits.

### Modified: `src/components/factory/EditMachineModal.tsx`
- Export `EffectsPanel` (currently file-private function).
- Export `applyRecipeConstraints` helper.
- No logic changes.

### Untouched
- `RecipeRow.tsx` — `BeaconCell` call site props unchanged.
- Solver (`src/solver/`) — still reads `beacon.modulesPerBeacon` and
  `beacon.distributionEfficiency`; schema backward-compat ensures values are
  always present.

---

## Reused code

| What | Where |
|---|---|
| `Modal` backdrop | `src/components/Modal.tsx` |
| `EffectsPanel` | export from `src/components/factory/EditMachineModal.tsx` |
| `applyRecipeConstraints` | export from `src/components/factory/EditMachineModal.tsx` |
| Machine-picker inline-expand pattern | `src/components/factory/EditMachineModal.tsx` (copy the expand/collapse + list pattern) |
| `iconUrl()` | `src/utils/iconUrl.ts` |
| `updateNodeBeacon` | `src/store/blockStore.ts` |

---

## Verification

- **Type check**: `npx tsc --noEmit` — clean (schema additions are additive, old
  game-data files still parse thanks to `.default({})`).
- **Manual `npm run dev`**:
  1. Row with no beacon: `+` placeholder; clicking opens modal; selecting a
     beacon type + module + count creates a `BeaconConfig`; cell shows beacon
     icon + count.
  2. Row with existing beacon: modal opens with current values; changing any
     field updates the solver live.
  3. Clicking beacon icon → picker expands; picking a different type auto-updates
     `modulesPerBeacon` and `distributionEfficiency`.
  4. Clicking module icon → module picker expands; selecting updates icon + effects.
  5. Effects panels recalculate on every change.
  6. "Remove beacon" → cell reverts to `+` placeholder; modal closes.
  7. Esc and "Close" dismiss without removing the beacon.
  8. MachineCell / ModuleCell open EditMachineModal correctly — no regression.
  9. With `gameData.beacons = {}` (current sample data): beacon-type picker shows
     "no beacon data"; two extra inputs appear — "Modules/beacon" (`modulesPerBeacon`)
     and "Efficiency" (`distributionEfficiency`) — so the user can still configure
     the beacon fully without beacon-type data.

---

## Out of scope

- Updating the Lua game-data exporter to populate `beacons` (separate task;
  the `.default({})` on the schema ensures graceful degradation until that lands).
- Module slot slider (replaced by beacon-type auto-fill; `modulesPerBeacon` remains
  in the schema for backward-compat but is not exposed as a UI input).
- Defaults / bookmark presets.
