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
  name: string          // English display name (locale resolved, Factorio `__ITEM__x__` / `__ENTITY__x__` / `__FLUID__x__` / `__TILE__x__` placeholders expanded; falls back to id)
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
  name: string               // display name, see below
  category: string           // open string; absent in the dump means "crafting"
  craftingTime: number       // seconds at crafting speed 1 (dump: energy_required, default 0.5); > 0
  ingredients: Ingredient[]
  products: Product[]
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
  minimumTemperature?: number   // informational; not used by the solver
  maximumTemperature?: number
}

interface Product {
  itemId: string
  type: 'item' | 'fluid'
  amount: number                // >= 0; the only amount the solver reads
  probability?: number          // 0–1; absent means 1
  amountMin?: number            // informational, see below
  amountMax?: number
  ignoredByProductivity?: number
}
```

`ingredients`, `products` and `madeIn` (and `Module.limitation` /
`limitationBlacklist`) accept an empty object `{}` as an empty array. This is a
compatibility shim for bundles that serialised empty tables as objects.

**Recipe name.** The build script uses, in order: the recipe's `localised_name`,
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

**`allowProductivity`.** The solver does not check it: `computeNodeEffects` applies
whatever productivity the node's modules and beacon provide. The machine and beacon
modals zero productivity in their "Recipe effects" panel when the recipe disallows
it, but they do not stop the user from adding productivity modules.

### Machine

```ts
interface Machine {
  id: string
  name: string
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
  name: string
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
  name: string
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
  name: string
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
  name: string
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
progression and are shown whenever "Hidden recipes" is ticked. Extraction recipes (`Recipe.extraction`) need no research and are always inside the horizon; their drills and pumps are gated like any other machine, through the item that places them. No targets,
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
category has no entry). A category the data has no default for at all is not affected. Machine,
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

Every `iconPath` is written by the build script as the path of the PNG it
extracted (and composited, for layered icons) into the icons output directory.
Because that directory is resolved to an absolute path, the committed bundles
contain absolute filesystem paths of the form
`/<…>/public/data/<dataset>/icons/<id>.png`. An empty string means no icon could
be resolved.

Technology icons are written to `icons/technology/<id>.png`, in their own folder
because a technology can share its id with an item (`automation-science-pack`),
and are capped at 128 px.

`src/utils/iconUrl.ts` turns that into a URL: it keeps everything after
`/public/` and prefixes Vite's `BASE_URL`. `iconUrlWebp` swaps `.png` for `.webp`;
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

The user's work is an `AppState`. It is saved to `localStorage` on every change under
`factorio-planner:app-state:<sourceId>`, one key per game data set (`nullius`,
`kompetenz-seablock`, `custom:<filename>#<modSet fingerprint>`; trailing slashes
dropped). An unreadable stored plan is kept under `<key>:corrupt`. The pre-per-data-set
key `factorio-planner:app-state` is adopted once by the first data set without a plan
and then removed (see [ui.md](ui.md#game-data-set)). The plan is
restored through
`parseAppState` (`src/data/loader.ts`, which throws `AppStateLoadError` on invalid
data), and downloaded as JSON by the menu's "Export plan" item. The "Import plan" item reads the same
shape through `checkPlanImport` (`src/store/persistence.ts`): `parseAppState` plus a non-empty
`blocks` check, a uniqueness check (block ids; sub-plan and node ids within a block) and an
`activeBlockId` fallback to the first block; the localStorage load path applies none of these.

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
}
```

Ids that are not in the loaded data set's `technologies` are ignored and kept.

### Block

A block is one factory (one tab in the UI). The solver solves each block as a
single LP; blocks can receive items from one another through `inputConnections`.
Plans are stored per data set (keyed by source id), so a block carries no game-data version.

```ts
interface Block {
  id: string
  name: string
  color: string              // '#rrggbb', display colour
  goals: ProductionGoal[]    // default []
  noImportItems: string[]    // default []; item ids the LP may not import as raw inputs
  inputConnections: BlockConnection[]  // default []; items received from other blocks
  rootPlan: SubPlan
}

interface BlockConnection {
  id: string           // uuid
  itemId: string
  fromBlockId: string  // block whose net output of itemId supplies this block
}

interface ProductionGoal {
  id: string        // uuid
  itemId: string
  rate: number      // > 0, items per minute
}
```

**Legacy migration.** `BlockSchema` preprocesses its input with `migrateBlock`:
older plans stored `goals` and `noImportItems` on each sub-plan. The migration
walks the tree, hoists them to the block (goals deduplicated by `itemId` with
rates summed; non-positive rates dropped; no-import items deduplicated), and strips
them from the sub-plans. Block-level values already present on the input win.

**Block colour.** `AppStateSchema` preprocesses the whole state with `assignMissingBlockColors`, because a colour for one block depends on the others. A block without a valid `#rrggbb` colour gets the first palette colour no block uses yet, in block order, so loading the same old plan always gives the same colours; valid colours are kept (lower-cased), duplicates included. When all 16 palette colours are taken, the block at index `i` in block order falls back to `palette[i % 16]`. New and duplicated blocks pick a random palette colour, preferring one no other block uses (a duplicate never takes its source's colour). The palette and these rules live in `src/data/blockColors.ts`; it avoids the hues that carry meaning in the summary panes (teal, amber, grey).

**Connections.** A connection is stored on the *consumer* block and points at its
source by id, so renaming a block changes nothing and a source is never modified
by its consumers. A block must not connect to itself or twice to the same
`(fromBlockId, itemId)`, connections must not form a cycle, and a connection must not
supply one of the consumer's own goal items. The store enforces all four (rules in
`src/store/connections.ts`) when a connection is added, on redo of an add and on undo of a
removal (a command that is no longer legal is dropped from the history instead of applied).
Adding a goal does not remove an existing connection for the same item: such a connection stays
in the plan and the solver reads it as `unused` (a goal is never fed). The connection actions
take an optional target block (default: the active one), and the undo entry goes to *that*
block's history; `undo` / `redo` only read the active block's history, so an edit made on another
block (e.g. from the block graph) is not reverted by undoing while a different block is active.
Deleting a block removes the connections
that read from it (`removeBlock`), but imported or hand-edited JSON can still
contain a source that does not exist or a cycle: the solver ignores those
connections and reports them as `missing-source` / `cycle`. Plans saved before
connections existed have no `inputConnections` field and load with `[]`. How the
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
  machineId?: string            // overrides defaultMachines[recipe.category]
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
  so a plan saved with a zero pin still loads.
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
```

`unsatisfied` lists, in this order: goal shortfalls, intermediate slack (items the
LP had to import to balance), and raw-resource consumption. The UI shows it as the
Ingredients pane.

```ts
interface MultiBlockSolve {
  results: Record<string, SolverResult>  // blockId -> result, every block present
  flows: ConnectionFlow[]                // one per BlockConnection
  errors: Record<string, string>         // blockId -> message for a block whose solve threw
}

interface ConnectionFlow {
  connectionId: string
  fromBlockId: string
  toBlockId: string
  itemId: string
  available: number   // items/min the source still offered when this consumer was solved
  rate: number        // items/min actually delivered
  status: ConnectionFlowStatus
}

type ConnectionFlowStatus = 'ok' | 'unused' | 'limited' | 'missing-source' | 'cycle'
```

`unused` means nothing is delivered and the consumer does not need an outside
supply of the item; `limited` means the consumer takes everything on offer and
still imports the item. `missing-source` and `cycle` flows have `rate` and
`available` 0.

What triggers each warning is described in [solver.md](solver.md); how the UI
presents them is in [ui.md](ui.md).
