# Game export script — beacon data

The app's `BeaconEntitySchema` expects a `beacons` record in `game-data.json`
that is currently missing. Until it is populated, the UI runs in legacy mode
(manual `modulesPerBeacon` + `distributionEfficiency` inputs, no beacon-type
picker).

---

## Required output shape

Add a top-level `"beacons"` key alongside the existing `"machines"` and
`"modules"` keys:

```json
{
  "beacons": {
    "beacon": {
      "id": "beacon",
      "name": "Beacon",
      "iconPath": "…/icons/beacon.png",
      "hidden": false,
      "moduleSlots": 2,
      "distributionEfficiency": 0.5,
      "allowedEffects": ["speed", "consumption", "productivity", "pollution", "quality"]
    },
    "nullius-beacon-1": { … }
  }
}
```

Field-by-field mapping from the Factorio Lua prototype:

| JSON field | Lua prototype field | Notes |
|---|---|---|
| `id` | `entity.name` | The internal prototype name |
| `name` | `entity.localised_name` (resolved) | Human-readable localised name |
| `iconPath` | icon file path | Same convention as machines/modules |
| `hidden` | `entity.hidden` | `true` → omit from the UI picker |
| `moduleSlots` | `entity.module_slots` | Integer ≥ 0; how many modules fit in one beacon |
| `distributionEfficiency` | `entity.distribution_effectivity` | Float 0–1; vanilla beacon = `0.5` |
| `allowedEffects` | `entity.allowed_effects` | String array; same values as `EffectNameSchema`: `speed`, `productivity`, `consumption`, `pollution`, `quality` |

---

## Lua snippet (reference)

The beacon prototype is a `LuaEntityPrototype` of type `"beacon"`. The relevant
fields are accessible at data-stage via `data.raw["beacon"]` or at runtime via
`game.entity_prototypes`:

```lua
-- Collect all beacon prototypes (data-stage or runtime, adjust as needed)
local beacons = {}
for name, entity in pairs(data.raw["beacon"]) do
  -- Resolve allowed_effects: may be nil (= all effects allowed) or a table
  local allowed = {}
  if entity.allowed_effects then
    for _, eff in ipairs(entity.allowed_effects) do
      table.insert(allowed, eff)
    end
  else
    -- nil means no restriction — include all five effect names
    allowed = {"speed", "productivity", "consumption", "pollution", "quality"}
  end

  beacons[name] = {
    id                     = entity.name,
    name                   = entity.localised_name,   -- resolve before serialising
    iconPath               = <icon resolution logic identical to machines>,
    hidden                 = entity.hidden or false,
    moduleSlots            = entity.module_slots or 0,
    distributionEfficiency = entity.distribution_effectivity or 0,
    allowedEffects         = allowed,
  }
end

-- Add to the exported table:
-- export_table.beacons = beacons
```

> **`allowed_effects` nil-handling**: in Factorio's API, `nil` on
> `allowed_effects` means *all* effects are permitted. The snippet above
> expands `nil` to the full list so the JSON always contains an explicit array.

---

## Sample data (nullius mod)

The sample file `data/samples/nullius/game-data.json` now ships with
hand-authored beacon entries based on typical Nullius mod values. These are
**estimates** — re-run `node scripts/build-game-data.js` after a real Factorio
dump to replace them with authoritative values.

| Beacon | Module slots | Efficiency |
|---|---|---|
| Small beacon 1 | 1 | 50% |
| Small beacon 2 | 2 | 50% |
| Small beacon 3 | 3 | 50% |
| Large beacon 1 | 4 | 30% |
| Large beacon 2 | 6 | 30% |
| Super beacon (ee) | 20 | 100% |

---

## Behaviour once populated

When `gameData.beacons` is non-empty:

- The beacon picker in `BeaconModal` lists all non-hidden beacons with their
  icons, sorted by name.
- Selecting a beacon auto-fills `modulesPerBeacon` ← `moduleSlots` and
  `distributionEfficiency` ← `distributionEfficiency` into `BeaconConfig`.
- The manual override inputs (`Modules/beacon`, `Efficiency`) are hidden.
- The `beaconId` is persisted in the plan so the correct beacon type is shown
  on reload.
