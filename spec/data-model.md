# Data Model

`src/data/schema.ts` is the source of truth. Every game-data and plan type is
declared as a Zod schema and the TypeScript type is derived from it with
`z.output<typeof FooSchema>`. `src/data/types.ts` re-exports those types and adds
the transient solver types, which have no schema. This document mirrors both files;
if they disagree, the code wins and this file should be fixed.

The shapes below are the **parsed** (output) types: defaults are already applied
and preprocessors have already run.

---

## Game data

A game-data bundle is a single JSON file. It is produced offline by
`scripts/build-game-data.js` from the raw prototype dump that `factorio --dump-data`
writes (see the README for the commands). The app loads it at runtime through
`parseGameData` / `loadGameDataFromJson` (`src/data/loader.ts`), which validate it
against `GameDataSchema` and throw `GameDataLoadError` on failure.

Bundles for Nullius and Kompetenz Seablock are committed under `public/data/`;
the user can also upload a custom bundle (see [ui.md](ui.md)).

### GameData (root)

```ts
interface GameData {
  factorioVersion: string                     // base game version, e.g. "2.0.76"
  modSet: Record<string, string>              // enabled mod name -> version (includes "base")
  items: Record<string, Item>                 // items AND fluids, keyed by id
  recipes: Record<string, Recipe>
  machines: Record<string, Machine>
  modules: Record<string, Module>
  beacons: Record<string, BeaconEntity>       // default {}
  defaultMachines: Record<string, string>     // recipe category -> machine id
  itemGroups: Record<string, ItemGroup>       // default {}
  itemSubgroups: Record<string, ItemSubgroup> // default {}
  technologies: Record<string, Technology>    // default {}
  startingRecipes: string[]                   // recipe ids available without research; default []
}
```

`defaultMachines` maps each recipe category to the machine with the highest
`craftingSpeed` among the machines that list that category (ties keep the first
one found). It is used whenever a node has no `machineId` override.

### Item

Items and fluids share one record, distinguished by `type`.

```ts
interface Item {
  id: string            // prototype name, e.g. "iron-plate"
  name: string          // English display name (the game's resolved name from `<type>-locale.json` when the dump has it, otherwise locale resolved, Factorio `__ITEM__x__` / `__ENTITY__x__` / `__FLUID__x__` / `__TILE__x__` placeholders expanded; falls back to id)
  type: 'item' | 'fluid'
  iconPath: string      // see "Icon paths" below
  hidden: boolean       // default false
  stackSize?: number    // positive int; absent for fluids
  subgroup: string      // item-subgroup id; default ''
  order: string         // Factorio sort key; default ''
  placeResult?: string  // id of the machine or beacon this item places (prototype `place_result`)
}
```

`placeResult` is set only when it names a machine or beacon in the bundle; the
research horizon uses it to gate machines and beacons (see
[Technology](#technology)). Several items can place the same entity.

The build script exports every item-like prototype type (`item`, `tool`, `armor`,
`ammo`, `capsule`, `module`, …) as `type: 'item'`, plus every `fluid`.

### Recipe

```ts
interface Recipe {
  id: string
  name: string               // display name; the game's resolved name first, see below
  category: string           // open string; absent in the dump means "crafting"
  craftingTime: number       // seconds at crafting speed 1 (dump: energy_required, default 0.5); > 0
  ingredients: Ingredient[]
  products: RecipeProduct[]
  madeIn: string[]           // ids of machines whose craftingCategories include `category`, sorted
  allowProductivity: boolean // dump: allow_productivity, default false
  hidden: boolean            // default false
  mainProduct?: string | null
  subgroup: string           // default ''
  order: string              // default ''
  extraction?: boolean        // set on mining and offshore-pump recipes; always inside the research horizon
}

interface Ingredient {
  itemId: string
  type: 'item' | 'fluid'
  amount: number                // > 0
  minimumTemperature?: number   // shown on the recipe row's ingredient tile; not used by the solver
  maximumTemperature?: number
}

interface RecipeProduct {
  itemId: string
  type: 'item' | 'fluid'
  amount: number                // >= 0; the only amount the solver reads
  probability?: number          // 0–1; absent means 1
  amountMin?: number            // informational, see below
  amountMax?: number
  ignoredByProductivity?: number
}
```

Only recipe ingredients carry temperature bounds: fluid prototypes' default and maximum
temperatures and recipe products' temperatures are not exported.

`ingredients`, `products` and `madeIn` (and `Module.limitation` /
`limitationBlacklist`) accept an empty object `{}` as an empty array. This is a
compatibility shim for bundles that serialised empty tables as objects.

**Recipe name.** The build script uses, in order: the game's resolved name (`recipe-locale.json`, when present), the recipe's `localised_name`,
its `recipe-name` locale key, then the display name of its main product. A name whose placeholders cannot be resolved (in a locale value, a plain `localised_name` string, a format argument, or any part of a `["", ...]` concatenation) counts as missing as a whole, so the build script moves on to the next source and finally to the id. Only `__ITEM__`, `__ENTITY__`, `__FLUID__` and `__TILE__` are expanded or treated as unresolved; other Factorio tokens such as `__CONTROL__x__` are left untouched.

**Recipe subgroup.** When the recipe has no `subgroup`, the build script uses the
subgroup of its main product (or of its single product).

**`mainProduct`.** Resolved at build time:

| Dump `main_product` | Products | Exported `mainProduct` | Parsed value |
|---|---|---|---|
| non-empty string | any | that item id | that item id |
| absent | exactly one | that product's id | that product's id |
| `""` (explicitly none) | several | `""` | `null` (schema preprocess maps `""` → `null`) |
| absent | zero or several | field omitted | `undefined` |

So `null` means "explicitly multi-output, no primary" and `undefined` means "no
declared primary". Consumers fall back to the first product:
`node.primaryProduct ?? recipe.mainProduct ?? recipe.products[0]?.itemId`
(see `primaryProduct` on `GameRecipeNode`).

**Product amounts.** For a product given as a range, the build script sets
`amount = amount ?? amount_max ?? 0` and copies `amount_min` / `amount_max` into
`amountMin` / `amountMax`. The solver only reads `amount`, so a range product is
treated as yielding its maximum. The Nullius bundle has no range products.

**Probability.** The solver multiplies `amount` by `probability` (expected value).

**`ignoredByProductivity`.** That many units of the product do not benefit from
productivity bonuses; only `amount − ignoredByProductivity` scales. In Nullius this
appears on Kovarex enrichment and coal liquefaction. See [solver.md](solver.md) for
the effective-amount formula.

**`allowProductivity`.** When false, `computeNodeEffects` drops the productivity bonus
of the node's modules and beacon (speed and consumption are kept), so the solver never
applies productivity to the recipe. A recipe missing from the game data is treated as
disallowing it. The machine, module and beacon pickers do not offer a module with a
positive productivity effect for such a recipe, and the modals zero productivity in their
"Recipe effects" panel. A productivity module already configured (from before, or from
another recipe) stays removable and is ignored by the solver.

### Machine

```ts
interface Machine {
  id: string
  name: string              // English display name; the game's resolved name (`entity-locale.json`) first, else the locale map
  type: 'assembling-machine' | 'furnace' | 'rocket-silo' | 'mining-drill' | 'offshore-pump'
  craftingSpeed: number          // > 0; default 1 when absent; the mining or pumping speed for a drill or pump
  energyUsageKw: number          // kW at full load
  energyType: 'electric' | 'burner' | 'heat' | 'void'
  drainKw: number                // idle drain in kW; 0 when absent
  moduleSlots: number            // int >= 0; dump absence means 0
  allowedEffects: EffectName[]   // sorted
  craftingCategories: string[]   // sorted
  iconPath: string
  hidden: boolean                // default false
}

type EffectName = 'speed' | 'productivity' | 'consumption' | 'pollution' | 'quality'
```

Crafting machines (assembling machines, furnaces, rocket silos) are exported from their prototype tables; mining drills and offshore pumps come from the extraction export (see [Extraction recipes](#extraction-recipes)). `energyType` comes
from `energy_source.type`; anything other than electric, burner or heat becomes
`'void'`. Energy strings in the dump (`"75kW"`, `"9.75MW"`) are parsed to kW; the
parser accepts W, kW, MW, GW and TW suffixes, and a bare number is read as watts.

### Module

```ts
interface Module {
  id: string
  name: string              // English display name; the game's resolved name (`item-locale.json`) first, else the locale map
  category: string                               // open string; 'unknown' when absent
  tier: number                                   // int >= 0
  effects: Partial<Record<EffectName, number>>   // additive fraction, e.g. 0.2 = +20%
  limitation: string[]                           // recipe ids the module is restricted to
  limitationBlacklist: string[]                  // recipe ids the module is excluded from
  iconPath: string                               // default ''
}
```

Effects may be negative (Nullius speed modules carry a negative `quality`). The
build script always emits `limitation` and `limitationBlacklist` as empty arrays,
so in practice every module is unrestricted; the UI still honours them if present.

### BeaconEntity

```ts
interface BeaconEntity {
  id: string
  name: string              // English display name; the game's resolved name (`entity-locale.json`) first, else the locale map
  iconPath: string
  hidden: boolean                 // default false
  moduleSlots: number             // int >= 0
  distributionEfficiency: number  // >= 0 (dump: distribution_effectivity, default 0)
  allowedEffects: EffectName[]    // dump absence means "all five effects"
}
```

### ItemGroup and ItemSubgroup

Used by the item and recipe pickers to lay out tabs (groups) and rows (subgroups).

```ts
interface ItemGroup {
  id: string
  name: string              // English display name; the game's resolved name (`item-group-locale.json`) first, else the locale map
  order: string      // default ''
  iconPath: string   // default ''
}

interface ItemSubgroup {
  id: string
  group: string      // ItemGroup id; default ''
  order: string      // default ''
}
```

### Technology

Research data, used to limit the recipes the pickers offer and to draw the
technology tree (the solver ignores it).

```ts
interface Technology {
  id: string
  name: string              // English display name; the game's resolved name (`technology-locale.json`) first, see below
  prerequisites: string[]     // Technology ids
  unlockedRecipes: string[]   // recipe ids from `unlock-recipe` effects
  iconPath: string            // default ''
  cost?: TechnologyCost | null
}

interface TechnologyCost {
  ingredients: { itemId: string; amount: number }[]   // science packs per unit
  count: number | null        // units; null when the count is a formula (count_formula)
  time: number                // seconds per unit
}
```

**Technology name.** The build script uses, in order: the game's resolved name (`technology-locale.json`), the technology's `localised_name`, its `technology-name` locale key, then for a leveled id (`<base>-<n>`) `"<base name> <n>"`, then the id. The game names the last level of an infinite technology without its number (`toolbelt-5` is "Toolbelt"); when such a name has no trailing digit and equals the game's name for the base id or for another level of the same base, the level is appended (`"Toolbelt 5"`). Names that are already distinct are kept as the game gives them.

`cost` is `undefined` when the bundle was exported without cost data and `null`
for a technology that is not researched in labs (completed by a research
trigger). The tree shows no cost for the first and "Trigger" for the second.

`startingRecipes` lists the recipes available at game start (the dump's
`recipe.enabled` is not `false`).

A plan's research horizon is `AppState.horizonTechnologyIds`: the technologies it
targets. A recipe is inside the horizon if it is a starting recipe or is unlocked
by a targeted technology or any of its prerequisites (followed transitively).
Recipes that are neither starting recipes nor unlocked by any exported technology
(for example ones only a script unlocks) are outside every horizon. The horizon
applies only to non-hidden recipes: hidden recipes are not part of research
progression and are shown whenever "Hidden recipes" is ticked. The recipe picker can also temporarily lift the horizon (its "Beyond research horizon" checkbox, picker-local and not persisted). Extraction recipes (`Recipe.extraction`) need no research and are always inside the horizon; their drills and pumps are gated like any other machine, through the item that places them. No targets,
or no technology data in the bundle, means no limit.

An item is offered as a goal under a horizon if no recipe produces it or at least one non-hidden recipe producing it is inside the horizon.
Hidden recipes are ignored: an item only hidden recipes produce is always offered,
and a hidden recipe does not keep an item whose non-hidden producers are all outside.

Machines, beacons and modules are gated through the items that make them. An item is
*obtainable* under a horizon by the rule above. A machine or beacon is available if it has
no known placing item (never gated) or at least one placing item is obtainable; the placing
items of an entity are the items whose `placeResult` names it, or, when no item in the bundle
has `placeResult`, the item with the same id as the entity. A module is available if its id is
not an item or that item is obtainable. For machines, beacons and modules (not for goal
items), a hidden item that no non-hidden recipe makes is never obtainable, so a hidden machine,
beacon or module of that kind is unavailable under every horizon; an entity with no placing item
at all is still never gated. A hidden machine is never the horizon's default machine, even when
it is the static default. No limit means everything is available.

A row without an explicit machine uses the horizon's default machine for its recipe
category: the category's static `defaultMachines` entry if that machine is available, else the
fastest available non-hidden machine of the category (first one wins a tie), else none (the
category has no entry). A category the data has no default for at all is not affected. The plan's
`defaultMachineOverrides` (see [AppState](#appstate)) are then layered on top
(`applyDefaultMachineOverrides`): an override replaces the category's default when its machine exists,
is not hidden, crafts the category and is inside the horizon; any other override is ignored but kept,
so it applies again when the horizon widens. `horizonFor` (`src/store/horizon.ts`) returns the horizon
with the overrides applied, and every reader (the solver wiring, the table, the machine and beacon
modals) goes through it. Machine,
module and beacon choices already stored in the plan are never rewritten when the horizon
narrows; they are kept and flagged in the UI.

### Extraction recipes

The build script turns resources and offshore pumps into ordinary recipes so the solver needs no special case. They carry `extraction: true` and their own categories; the colon cannot collide with a Factorio prototype name.

**Mining recipe**, one per resource that at least one exported drill can mine:

- `id` `mining:<resource name>`; `name` `<resource name> (mining)`; `category` `mining:<resource category>` (the default resource category is `basic-solid`), or `mining-with-fluid:<resource category>` when the resource has a `required_fluid`.
- `craftingTime` is `minable.mining_time` (resources without `minable` or with a non-positive time are skipped). `products` come from `minable.results`, normalised like recipe products (a ranged `amount_min`/`amount_max` product without `amount` becomes its mean, because the solver reads only `amount` and `probability`), or from `minable.result` with `minable.count` (default 1).
- `ingredients` is empty, or the required fluid with amount `fluid_amount / 10`. A resource with `required_fluid` but no positive `fluid_amount` is skipped with a warning.
- `madeIn` lists the drills whose `resource_categories` include the category; for a fluid-requiring resource, only drills with an input fluid box. `allowProductivity` is true.
- `hidden` when the resource is hidden or every drill in `madeIn` is hidden. `subgroup` is the main product's, `order` the resource's.

**Drill machine** (`type: 'mining-drill'`), only for drills that can mine an exported resource: `craftingSpeed` is `mining_speed`, `craftingCategories` are `mining:<c>` for each resource category plus `mining-with-fluid:<c>` when the drill has an input fluid box. `allowedEffects` is every effect when the prototype has no `allowed_effects` (vanilla drills accept modules), otherwise the listed ones (`{}` means none). Energy follows the other machines; an energy type of `void` (including any unrecognised source type) is 0 kW.

**Offshore pump** (`type: 'offshore-pump'`): the fluids a pump makes are its `fluid_box.filter`, else its `fluid`, else the distinct fluids of the tiles. `craftingSpeed` is `pumping_speed`, `craftingCategories` are `offshore:<fluid>`. Each fluid gets one recipe `offshore:<fluid>` named `<fluid> (offshore pump)` with `craftingTime` 1 and one product of 60 units, so a pump makes `60 x pumping_speed` per second (1200/s at speed 20, as in Factorio 2.0).

`defaultMachines` for these categories is the fastest machine, as for any other category, except that hidden machines are skipped unless every machine of the category is hidden.

### Icon paths

Every `iconPath` is the URL of the extracted PNG (composited, for layered
icons) relative to `public/`: `/data/<dataset>/icons/<id>.png`, or
`/data/<dataset>/icons/technology/<id>.png` for technologies. The build script
derives it from the icons output directory relative to `public/`
(`scripts/icon-url.js`), so no machine-specific path is committed. When the icons
directory is outside `public/`, the script warns and falls back to a
cwd-relative path. An empty string means no icon could be resolved.

Technology icons are written to `icons/technology/<id>.png`, in their own folder
because a technology can share its id with an item (`automation-science-pack`),
and are capped at 128 px.

`src/utils/iconUrl.ts` turns that into a URL by prefixing Vite's `BASE_URL`; it
also still accepts legacy absolute paths containing `/public/`, keeping what
follows. `iconUrlWebp` swaps `.png` for `.webp`;
the `Icon` component offers the WebP as a `<source>` with the PNG as fallback.

### What the build script leaves out

- Recipes with `parameter: true` (blueprint parameter slots) are skipped.
- Quality is ignored: no quality tiers, `allow_quality`, or per-item quality.
  Nullius does not implement quality tiers. The `quality` effect name is kept so
  module effects parse, but the solver ignores it.
- `fluidbox_index` (physical fluid port routing) and `ignored_by_stats`
  (production-statistics display flag) are dropped; neither affects flow rates.
- `allow_decomposition` (recycling) is not exported.
- Burner fuel data (`fuel_categories`, `effectivity`) is not exported; burner
  machines only report `energyUsageKw`.
- `place_result` is kept only as `Item.placeResult`, and only when it names an
  exported machine (drills and pumps included) or beacon; other entities are not recorded.
- Technologies that are disabled (`enabled: false`) are dropped, with references
  to them, and so is every technology that has a disabled prerequisite (transitively),
  since it can never be researched. Effects other than `unlock-recipe` and research
  trigger conditions are not exported (a trigger technology gets `cost: null`).
  Research cost, time and technology icons are exported. Technologies that unlock nothing and are
  nobody's prerequisite (bonus and infinite upgrades) are dropped too.

### Source-data notes

Things to keep in mind when reading a bundle:

- Recipe categories are open strings, not an enum (Nullius defines dozens of
  custom ones). They are matched to machines through `craftingCategories`.
- Some recipes have an empty `madeIn` (no exported machine handles their
  category), and many are `hidden`. The recipe picker hides hidden recipes unless
  "Hidden recipes" is ticked.
- A bundle may lack `placeResult`: machines and beacons are then
  matched to the item with the same id, and an entity without such an item is never
  gated. `--patch-technologies` also writes `placeResult`. Nullius has no technology
  data, so its horizon never applies.
- A bundle may lack extraction data: it then has no mining or pumping recipes, and ores and pumped fluids are raw inputs as before. `node scripts/build-game-data.js --patch-extraction` adds them to an existing bundle (same mod-set check; safe to re-run), and refreshes `placeResult` and the default machines of the generated categories.
- Fluid resources (crude oil and similar) are exported at a fixed 100 % yield; the yield of the resource entity is not modelled. A resource that needs a fluid (`required_fluid`) consumes `fluid_amount / 10` per mining cycle, as the game does.
- A bundle may lack technology data (`technologies` and `startingRecipes` then
  default to empty and the horizon feature is hidden). `node
  scripts/build-game-data.js --patch-technologies` adds it to an existing bundle
  without re-exporting recipes or the other icons (it writes the cost and the
  technology icons); see the README. A bundle may also have technologies without
  `cost` or icons; the tech tree then falls back to a letter placeholder and no
  cost line.
- Approximate size of the committed Nullius bundle, for orientation only (it
  changes with every re-export): ~2,400 recipes, ~2,850 items and fluids, 136
  machines, a few dozen modules, ~20 beacons.

---

## App state (persisted)

The user's work is a set of plans, each an `AppState`. A game data set (`nullius`,
`kompetenz-seablock`, `custom:<filename>#<modSet fingerprint>`; trailing slashes dropped) holds several
plans, one of them active, and the app saves to `localStorage` on every change:

- `factorio-planner:plan-index:<sourceId>` holds a `PlanIndex` (`src/data/schema.ts`, parsed by
  `parsePlanIndex` in `src/data/loader.ts`): `{ activePlanId: string, plans: PlanEntry[] }`, where a
  `PlanEntry` is `{ id: string, name: string }`. The list order is the menu order.
- `factorio-planner:plan:<sourceId>/<planId>` holds one plan's `AppState`. An exported file adds a
  `dataSet` stamp (`PlanDataSetStamp`, `src/data/schema.ts`), read by `parsePlanDataSetStamp` and never
  persisted.
- An unreadable plan is kept under `<planKey>:corrupt`, an unreadable index under `<indexKey>:corrupt`.
- Plans stored by older versions (`factorio-planner:app-state:<sourceId>`, and before that the global
  `factorio-planner:app-state`) are migrated into this layout lazily when the data set is activated (see
  [ui.md](ui.md#game-data-set)).

Plan ids and names are chosen by `src/store/persistence.ts`, which owns the plan actions (new, switch,
rename, duplicate, delete, import); `src/store/plansStore.ts` mirrors the active data set's index in
memory. Duplicating or importing a plan runs it through `clonePlan` (`src/store/blockStore.ts`), which
gives every block, sub-plan, node, product and connection a fresh id so two plans never share ids
(solver results and undo history are keyed by block id).

Known limitations: the index is written whole from the tab's memory and `storage` events are not
observed, so with several tabs open the last write wins and may drop plans another tab created (their
plan keys remain, but no index lists them; see the backlog). A migrated old plan is copied as-is, without
fresh ids; if two copies of the same old plan are adopted (for example an older app version rewrote the
old key after migration), they share block ids, and switching between them may show the other's solver
results until the next solve lands (the debounced solve replaces them; undo history is cleared on every
switch). Autosave is suspended while game data is loading, so a data set switch cannot recreate keys it
just removed.

A plan is restored through `parseAppState` (`src/data/loader.ts`, which throws `AppStateLoadError` on
invalid data), and downloaded as JSON by the menu's "Export plan" item. The "Import plan…" item reads the
same shape through `checkPlanImport` (`src/store/persistence.ts`): `parseAppState` plus a non-empty
`blocks` check, a uniqueness check (block ids; sub-plan and node ids within a block) and an
`activeBlockId` fallback to the first block; the localStorage load path applies none of these. A checked
file is then added as a new plan by `importPlanAsNew`.

```
AppState
└── blocks: Block[]
    └── rootPlan: SubPlan
        ├── nodes: RecipeNode[]      (GameRecipeNode | SubPlanNode, in display order)
        └── subPlans: SubPlan[]      (recursive)
```

### AppState

```ts
interface AppState {
  blocks: Block[]
  activeBlockId: string
  horizonTechnologyIds: string[]   // technologies the plan targets; default [] = no limit
  defaultMachineOverrides: Record<string, string>   // crafting category -> machine id; default {}
}
```

Ids that are not in the loaded data set's `technologies` are ignored and kept.

### PlanDataSetStamp

The data set an exported plan was made for. It sits beside the `AppState` keys at the top level of an
exported file and is advisory: `AppStateSchema` strips it, and a missing or malformed one counts as no
stamp.

```ts
interface PlanDataSetStamp {
  id: string                // normalised source id: `nullius`, `kompetenz-seablock`, `custom:<filename>#<fingerprint>`
  name?: string             // display name: bundled label, or the uploaded file name without fingerprint
  factorioVersion?: string  // GameData.factorioVersion at export
}
```

`defaultMachineOverrides` holds the user's default machine per crafting category. The effective
default of a category is a valid override, else the horizon default (see
[Technology](#technology)); an override whose machine is unknown, hidden, cannot craft the category or
is outside the horizon is ignored but never removed. Like the horizon, it is per plan, not undoable,
saved with the plan and copied by duplicate and import.

### Block

A block is one factory (one tab in the UI). The order of `AppState.blocks` is the tab order; the user can change it (drag a tab, or Move left / Move right). The solver solves each block as a
single LP; blocks can receive items from one another through `inputConnections`.
Plans are stored per data set (keyed by source id), so a block carries no game-data version.

```ts
interface Block {
  id: string
  name: string
  color: string              // '#rrggbb', display colour; the user can change it to any `#rrggbb`; the UI offers the palette
  products: Product[]        // default []; what the block makes; other blocks may request them
  noImportItems: string[]    // default []; item ids the LP may not import as raw inputs
  inputConnections: BlockConnection[]  // default []; items received from other blocks
  rootPlan: SubPlan
}

interface BlockConnection {
  id: string           // uuid
  itemId: string
  fromBlockId: string  // block whose net output of itemId supplies this block
  maxRate?: number     // items/min, > 0: the most the consumer takes; absent = no limit
}

interface Product {
  id: string          // uuid
  itemId: string
  extraRate?: number  // > 0, items per minute: extra output beyond what other blocks request; absent = only what is requested
}
```

A saved `extraRate` of `0` loads as an absent key (like `maxRate`); a negative one is rejected. The solver reads each product as a solver-only `SolverGoal` `{ id, itemId, rate }` with `rate = extraRate ?? 0` plus what other blocks request, built when the block is flattened and dropped when it is 0 (see [spec/solver.md](solver.md)); `SolverGoal` is not part of the stored plan.

**Legacy migration.** `BlockSchema` preprocesses its input with `migrateBlock`.
Block-level `goals` load as `products` and each `rate` as `extraRate`. Older plans stored
`goals` and `noImportItems` on each sub-plan: the migration walks the tree, hoists them to
the block (goals become products, deduplicated by `itemId` with rates summed; non-positive
rates dropped; no-import items deduplicated), and strips them from the sub-plans. A
non-empty `products` on the input wins over legacy `goals`, which win over goals hoisted from
sub-plans. Saved plans are written back in the new shape on the next save.

**Legacy pulls.** Earlier plans stored `pull: true` on a connection whose consumer's demand drove the source. `AppStateSchema` preprocesses the whole state with `migrateLegacyPulls` (after `assignMissingBlockColors`): it first runs `migrateBlock` on a shallow copy of every raw block, so hoisted goals already exist as products, then, for every `pull: true` connection that the solver would have applied, adds a product for the item (no `extraRate`) to its source, whether or not the source has a recipe for it (a former pull from a block that could not make the item now shows as short in that block). A pull is left alone (the key is simply dropped on load) when it repeats an earlier `(source, item)` pair of the consumer, points at the consumer itself or a missing block, or when its source already has a product for the item or receives the item itself (one of its connections for the item comes from another existing block). The raw input is never mutated and the migration is idempotent. `BlockConnectionSchema` has no `pull` field; Zod strips it.

**Block colour.** `AppStateSchema` preprocesses the whole state with `assignMissingBlockColors`, because a colour for one block depends on the others. A block without a valid `#rrggbb` colour gets the first palette colour no block uses yet, in block order, so loading the same old plan always gives the same colours; valid colours are kept (lower-cased), duplicates included. When all 16 palette colours are taken, the block at index `i` in block order falls back to `palette[i % 16]`. New and duplicated blocks pick a random palette colour, preferring one no other block uses (a duplicate never takes its source's colour). The user can change a block's colour to any `#rrggbb` from its tab menu, which offers the palette (stored lower-case; sharing is allowed). The palette and these rules live in `src/data/blockColors.ts`; it avoids the hues that carry meaning in the summary panes (teal, amber, grey).

**Connections.** A connection is stored on the *consumer* block and points at its
source by id, so renaming a block changes nothing and a source is never modified
by its consumers. A block must not connect to itself or twice to the same
`(fromBlockId, itemId)`, and a connection must not supply one of the consumer's own products. The store enforces all three (rules in
`src/store/connections.ts`) when a connection is added, on redo of an add and on undo of a
removal (a command that is no longer legal is dropped from the history instead of applied).
Adding a product does not remove an existing connection for the same item: such a connection stays
in the plan and the solver reads it as `unused` (a product is never fed). The connection actions
take an optional target block (default: the active one), and the undo entry goes to *that*
block's history; `undo` / `redo` only read the active block's history, so an edit made on another
block (e.g. from the block graph) is not reverted by undoing while a different block is active.
Blocks may supply each other, directly or through other blocks (a loop of
two or more blocks, see [solver.md](solver.md#loops)); the store does not restrict that.
Deleting a block removes the connections
that read from it (`removeBlock`), but imported or hand-edited JSON can still
contain a source that does not exist or a block connected to itself: the solver ignores those
connections and reports them as `missing-source` / `self`. Plans saved before
connections existed have no `inputConnections` field and load with `[]`. A connection may carry
an optional `maxRate` (items/min, > 0): the most the consumer takes over it. Absent or `0` means
no limit (`0` loads as an absent key; unlike `pinnedRate`, whose `0` loads as a present `undefined`); clearing a limit deletes the key; a duplicated
block or plan copies it. A connection stores no kind: it is a *request* when its item is one of the source's products and *take existing* otherwise (see [solver.md](solver.md#requests)). The store refuses to create a request that would close a cycle of requests (a source that already requests, directly or through other blocks, from the consumer), when adding a connection, on redo of an add and on undo of a removal; it does not restrict takes. The check counts every connection to a product of its source, including ones the solver would ignore (the store does not run the solver, and whether a request is ignored changes as recipes are edited), so a legal request can be refused when the existing back request is itself ignored. Product commands carry no such guard: making an item a product can turn takes into requests that close a cycle, which the UI confirms first; undo and redo of product commands only change the active block and apply without asking. `removeProduct` undo restores the product at its old index, because the first product of an item receives the requested amount. How the
solver uses connections is in [solver.md](solver.md#connections-between-blocks).

### SubPlan

```ts
interface SubPlan {
  id: string
  name: string
  nodes: RecipeNode[]
  subPlans: SubPlan[]
  createdAt: string   // ISO datetime
  updatedAt: string   // ISO datetime
}
```

Sub-plans are UI grouping only (the "sub-factories" in the production table).
They carry no goals and no solver semantics: `flattenBlock`
(`src/solver/index.ts`) collects every node in the tree into one flat list before
solving. A new block's root sub-plan is named `"Main"`.

A nested sub-plan is referenced twice: the `SubPlan` object lives in its parent's
`subPlans`, and a `SubPlanNode` in the parent's `nodes` marks where the group is
displayed in the row order.

### RecipeNode

A discriminated union on `kind`. Nodes are authored by the user (added through the
recipe picker); the solver never creates or removes them.

```ts
type RecipeNode = GameRecipeNode | SubPlanNode

interface GameRecipeNode {
  kind: 'game-recipe'
  id: string
  recipeId: string
  machineId?: string            // undefined = the plan's effective default for recipe.category (horizon default, then defaultMachineOverrides)
  modules: ModuleConfig[]
  beaconConfig?: BeaconConfig
  pinnedRate?: number           // > 0; fixes the recipe's executions per minute
  byproductPolicy: Record<string, 'discard' | 'feed-back'>   // per product item id
  primaryProduct?: string       // which output the UI treats as the product
  byproductConsumer?: boolean   // run only to absorb surplus, see solver.md
}

interface SubPlanNode {
  kind: 'subplan'
  id: string
  subPlanId: string             // id of a SubPlan in the parent's subPlans
}
```

- **Legacy nodes.** `RecipeNodeSchema` injects `kind: 'game-recipe'` into any
  node that has no `kind`, so plans saved before sub-plans existed still load.
- **`pinnedRate`.** The solver uses it as an equality constraint on the recipe's
  throughput (executions per minute). The preprocess coerces `0` to `undefined`
  so a plan saved with a zero pin still loads. The unit is runs, not items: the UI
  shows and edits the primary product's rate and converts with that product's
  items per run.
- **`byproductPolicy`.** Missing entries mean `'feed-back'`. See
  [solver.md](solver.md) for how `'discard'` is applied.
- **`primaryProduct`.** Display-only override of the recipe's main product: it
  decides which output appears in the row's Products cell (the rest go to
  Byproducts) and which icon represents the recipe. The solver ignores it.
- **`byproductConsumer`.** See [solver.md](solver.md). The UI hides the pin
  control on such nodes.

### ModuleConfig and BeaconConfig

```ts
interface ModuleConfig {
  moduleId: string
  count: number                   // int > 0
}

interface BeaconConfig {
  beaconId?: string               // BeaconEntity id; absent on configs made without beacon data
  moduleId: string
  beaconCount: number             // int >= 0
  modulesPerBeacon: number        // int > 0
  distributionEfficiency: number  // >= 0
}
```

The total module count on a node is kept within the machine's `moduleSlots` by the
UI, not by the schema. When `beaconId` is set, the beacon modal copies the
entity's `moduleSlots` and `distributionEfficiency` into the config; the solver
reads only the config fields.

---

## Solver state (transient)

Defined in `src/data/types.ts`. Not persisted and not validated by Zod; produced
by `solveAll()` (one `SolverResult` per block) and held in `solverStore`. All rates
are per minute.

```ts
interface SolverResult {
  nodes: SolvedNode[]
  unsatisfied: UnsatisfiedItem[]
  warnings: SolverWarning[]
}

interface SolvedNode {
  recipeNodeId: string                 // GameRecipeNode.id
  inputRates: Record<string, number>   // itemId -> items/min consumed
  outputRates: Record<string, number>  // itemId -> items/min produced (gross)
  throughput: number                   // recipe executions/min
  machineCountExact: number
  machineCountCeil: number
  powerKw: number
}

interface UnsatisfiedItem {
  itemId: string
  rate: number   // items/min that must come from outside the block
}

type SolverWarning =
  | { type: 'no-recipe'; itemId: string }
  | { type: 'duplicate-recipe'; recipeId: string; count: number }
  | { type: 'infeasible-pins'; recipeIds: string[] }
  | { type: 'overconstrained'; surplusItems: { itemId: string; rate: number }[] }
  | { type: 'loop-not-converged'; blockIds: string[]; rounds: number }
```

`unsatisfied` lists, in this order: goal shortfalls, intermediate slack (items the
LP had to import to balance), and raw-resource consumption. The UI shows it as the
Ingredients pane.

```ts
interface MultiBlockSolve {
  results: Record<string, SolverResult>  // blockId -> result, every block present
  flows: ConnectionFlow[]                // one per BlockConnection
  errors: Record<string, string>         // blockId -> message for a block whose solve threw
  loops: BlockLoop[]                     // one per loop of blocks that supply each other; [] when there is none
}

interface BlockLoop {
  blockIds: string[]            // member order: the entry block first, then topologically (only cycle-closing connections run backwards)
  connectionIds: string[]       // in-loop connections: members in order, each in inputConnections order
  backConnectionIds: string[]   // connections whose source comes later in blockIds than its consumer
  rounds: number                // rounds solved
  converged: boolean
}

interface ConnectionFlow {
  connectionId: string
  fromBlockId: string
  toBlockId: string
  itemId: string
  available: number   // items/min this consumer could take: the source's unclaimed offer, limited by maxRate
  capped: boolean     // true when maxRate is below the source's unclaimed offer (the limit bounds `available`; for a request, true only when the limit cut the request and the source offered at least the limit)
  rate: number        // items/min actually delivered
  status: ConnectionFlowStatus
  loop?: true         // both ends are members of one loop
  kind: ConnectionKind             // 'request' (the item is a product of the source and the request applies) | 'take'
  requested?: number               // present iff kind is 'request': items/min the consumer asked the source to make (may be 0)
  requestIgnored?: RequestIgnoredReason  // the item is a product of the source but the request is not applied; the connection takes existing output
}

type ConnectionKind = 'request' | 'take'
type RequestIgnoredReason = 'request-loop' | 'source-receives' | 'duplicate'

type ConnectionFlowStatus = 'ok' | 'unused' | 'limited' | 'missing-source' | 'self'
```

`unused` means nothing is delivered and the consumer does not need an outside
supply of the item; `limited` means the consumer takes everything the connection
allows (the source's offer or its `maxRate`; `capped` tells which) and still imports
the item. `missing-source` and `self` flows have `rate` and
`available` 0. `kind` is `'request'` iff `requested` is present; `requestIgnored` is present iff the item is a product of the
source but the request is not applied (and then `kind` is `'take'`), for connections with an existing source other than
the block itself (`duplicate`: the connection repeats an earlier (source, item) pair of the same block, which only imported JSON can produce).

What triggers each warning is described in [solver.md](solver.md); how the UI
presents them is in [ui.md](ui.md).
