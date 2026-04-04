# Lua Export Script

The game data bundle is produced by a Lua script that runs inside Factorio. It reads `data.raw` after all mods have been loaded and processed, then writes a JSON file that the planner imports.

---

## Delivery

Two delivery options, both should be implemented:

1. **In-game console script** — paste into Factorio's Lua console (`/c ...`). Writes the JSON to the Factorio script output directory. Simple, no install required.
2. **Helper mod** — a minimal mod (`factorio-planner-export`) that adds a button or console command. More user-friendly for repeat exports. Does not affect gameplay.

---

## What to Export

### Items and Fluids

From `data.raw["item"]`, `data.raw["fluid"]`, and all item subtypes (`tool`, `armor`, `ammo`, `module`, `capsule`, `equipment`, `blueprint`, `deconstruction-item`, `upgrade-item`, `space-platform-starter-pack`, etc.).

For each item/fluid:
- `name` (internal id)
- `localised_name` (resolved to English via `game.item_prototypes[name].localised_name` or fallback to name)
- `type` (`"item"` or `"fluid"`)
- `stack_size` (items only)
- `icon` path or sprite reference (for display in the planner)

### Recipes

From `data.raw["recipe"]`, using the **normal** (non-expensive) variant when both exist. Post-2.0, expensive mode was removed so this is straightforward.

For each recipe:
- `name`
- `category` (defaults to `"crafting"` if absent)
- `energy_required` (crafting time in seconds, defaults to 0.5)
- `ingredients` — array of `{name, amount, type?}` (type defaults to `"item"`)
- `results` — array of `{name, amount, type?, probability?}`
- `enabled` — whether it's available without research (informational only)
- `hidden` — skip hidden recipes unless they have a producing machine

**Note:** Recipes with `results` use the new format; some older recipes use `result`/`result_count`. The script must normalise both to `results[]`.

### Machines (Crafting categories)

Collect all entity types that can craft: `"assembling-machine"`, `"furnace"`, `"rocket-silo"`, `"chemical-plant"`, `"refinery"`, `"lab"` (if relevant).

For each machine:
- `name`
- `crafting_speed`
- `energy_usage` (kW) — parse the string value (e.g. `"150kW"` → 150)
- `energy_source.type` (`"electric"`, `"burner"`, `"heat"`, `"void"`)
- `energy_source.drain` (kW, electric machines only)
- `module_slots` (defaults to 0)
- `crafting_categories` — array of category strings
- `allowed_effects` — which module effects this machine accepts

### Modules

From `data.raw["module"]`:
- `name`
- `tier`
- `effect` — `{speed?, productivity?, consumption?, pollution?}`
- `limitation` — array of recipe names this module is restricted to (empty = unrestricted)
- `limitation_blacklist` — recipes explicitly excluded

### Quality (2.0)

Factorio 2.0 adds quality tiers. For v1, quality is **not** modelled in the solver — all recipes and items are treated as normal quality. The export script should emit a `supportsQuality: true` flag so the planner can show a warning that quality effects are ignored.

---

## Output Format

The script writes a single JSON file matching the `GameData` interface from [data-model.md](data-model.md).

```json
{
  "version": "2.0.28",
  "modSet": ["base", "space-age", "elevated-rails"],
  "supportsQuality": true,
  "items": { ... },
  "recipes": { ... },
  "machines": { ... },
  "modules": { ... },
  "defaultMachines": {
    "crafting": "assembling-machine-3",
    "smelting": "electric-furnace",
    "chemistry": "chemical-plant",
    ...
  }
}
```

---

## Output Location

- Console script: `%APPDATA%\Factorio\script-output\factorio-planner-export.json` (Windows) / `~/.factorio/script-output/` (Linux/Mac)
- Helper mod: same location, triggered on button press

The planner's import dialog instructs the user to locate this file.

---

## Icon Handling

Icons are the trickiest part. Options in order of preference:

1. **Sprite sheet approach**: The export script writes icon paths; a separate build-time script fetches the game's icon files and assembles them into a sprite sheet that ships with the planner. Requires access to game files at build time.
2. **Inline base64**: The export script reads icon data and base64-encodes it into the JSON. Works but bloats the bundle.
3. **No icons for v1**: Show item names only, add icon support later.

Start with option 3; add option 1 once the core planner is working.
