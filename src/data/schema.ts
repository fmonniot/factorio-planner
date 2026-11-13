import { z } from 'zod'
import { HEX_COLOR_RE, assignMissingBlockColors } from './blockColors'
import { reparentSubPlans } from './subPlanTree'
import { makeHereOf } from './sourceRules'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Factorio serialises empty Lua tables as {} (object) rather than [] (array),
 * and older or hand-made exports may carry that shape through. This
 * preprocessor normalises empty objects to empty arrays before Zod validates
 * the array schema, so the rest of the schema stays clean.
 */
function luaArray<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.preprocess(
    v =>
      v != null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.keys(v as object).length === 0
        ? []
        : v,
    z.array(itemSchema),
  )
}

// ---------------------------------------------------------------------------
// Game Data schemas
// ---------------------------------------------------------------------------

export const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['item', 'fluid']),
  iconPath: z.string(),
  /** Mean colour of the icon's opaque pixels, `#rrggbb` (scripts/icon-color.js); absent in older bundles and for items without an icon; a malformed value reads as absent. */
  iconColor: z.string().regex(/^#[0-9a-f]{6}$/).optional().catch(undefined),
  hidden: z.boolean().default(false),
  stackSize: z.number().int().positive().optional(),
  subgroup: z.string().default(''),
  order: z.string().default(''),
  /** Id of the machine or beacon this item places (prototype `place_result`); only set when it names a machine or beacon in the bundle. */
  placeResult: z.string().optional(),
  /** Fluids: prototype `default_temperature`, the temperature of a unit when a recipe product states none. */
  defaultTemperature: z.number().optional(),
  /** Fluids: prototype `max_temperature` (equal to `defaultTemperature` when the prototype omits it). */
  maxTemperature: z.number().optional(),
  /** Fuel: prototype `fuel_value` in kJ per item (per unit for a fluid); absent = not a fuel (or a bundle exported before fuel data). */
  fuelValueKj: z.number().positive().optional(),
  /** Burner fuel (items only): prototype `fuel_category`, matched against `Machine.fuelCategories`. */
  fuelCategory: z.string().optional(),
  /** Burner fuel (items only): prototype `burnt_result`. A fuel with one is never offered (its burnt output is not modelled). */
  burntResult: z.string().optional(),
})

export const IngredientSchema = z.object({
  itemId: z.string(),
  type: z.enum(['item', 'fluid']),
  amount: z.number().positive(),
  minimumTemperature: z.number().optional(),
  maximumTemperature: z.number().optional(),
})

export const RecipeProductSchema = z.object({
  itemId: z.string(),
  type: z.enum(['item', 'fluid']),
  amount: z.number().nonnegative(),
  probability: z.number().min(0).max(1).optional(),
  amountMin: z.number().nonnegative().optional(),
  amountMax: z.number().nonnegative().optional(),
  ignoredByProductivity: z.number().nonnegative().optional(),
  /** Fluid products: explicit output `temperature`; absent means the fluid's `defaultTemperature`. */
  temperature: z.number().optional(),
})

export const RecipeSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  craftingTime: z.number().positive(),
  ingredients: luaArray(IngredientSchema),
  products: luaArray(RecipeProductSchema),
  madeIn: luaArray(z.string()),
  allowProductivity: z.boolean(),
  hidden: z.boolean().default(false),
  // null = explicitly multi-output with no primary (main_product = "" in the prototype).
  // build-game-data.js emits "" for the multi-output case; we normalise to null here.
  mainProduct: z.preprocess(
    v => (v === '' ? null : v),
    z.string().nullable().optional(),
  ),
  subgroup: z.string().default(''),
  order: z.string().default(''),
  /** True for a recipe the exporter makes from a resource (mining drill) or an offshore pump. Always inside the research horizon. */
  extraction: z.boolean().optional(),
  /** True for a recipe the exporter makes from a boiler (or heat exchanger), generator, burner generator, reactor or solar panel. Always inside the research horizon (its machine is gated). */
  power: z.boolean().optional(),
})

export const ItemGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.string().default(''),
  iconPath: z.string().default(''),
})

export const ItemSubgroupSchema = z.object({
  id: z.string(),
  group: z.string().default(''),
  order: z.string().default(''),
})

export const EffectNameSchema = z.enum([
  'speed',
  'productivity',
  'consumption',
  'pollution',
  'quality',
])

export const MachineSchema = z.object({
  id: z.string(),
  name: z.string(),
  // For 'mining-drill' and 'offshore-pump', craftingSpeed is the mining or pumping speed.
  // Generation machines ('boiler', 'generator', 'burner-generator', 'reactor', 'solar-panel') have speed 1 and no power draw:
  // their energy is the recipe.
  type: z.enum([
    'assembling-machine', 'furnace', 'rocket-silo', 'mining-drill', 'offshore-pump',
    'boiler', 'generator', 'burner-generator', 'reactor', 'solar-panel',
  ]),
  // Reactors: `neighbour_bonus`, extra heat per adjacent working reactor (1 = +100 %); recipes assume
  // no neighbours, the row's `GameRecipeNode.neighbourCount` scales the heat; absent = none.
  neighbourBonus: z.number().nonnegative().optional(),
  // Some older exports omit this field. Default to 1 so they still load;
  // re-export to get real values.
  craftingSpeed: z.number().positive().default(1),
  energyUsageKw: z.number().nonnegative(),
  // 'fluid-burner': a crafting machine whose energy source burns fluid (`burns_fluid`); other fluid sources stay 'void'.
  energyType: z.enum(['electric', 'burner', 'heat', 'void', 'fluid-burner']),
  drainKw: z.number().nonnegative(),
  // Burner machines: fuel categories the energy source accepts; absent = no fuel data (the row keeps its
  // electricity-style power draw).
  fuelCategories: z.array(z.string()).optional(),
  // Burner and fluid-burner machines: energy_source.effectivity (fuel burnt = energy used / effectivity); absent = 1.
  effectivity: z.number().positive().optional(),
  // Fluid-burner machines: the source's `fluid_box.filter`, the only fluid it burns; absent = any fluid with a fuel value.
  fuelFluid: z.string().optional(),
  moduleSlots: z.number().int().nonnegative(),
  allowedEffects: z.array(EffectNameSchema),
  craftingCategories: z.array(z.string()),
  iconPath: z.string(),
  hidden: z.boolean().default(false),
})

export const ModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  tier: z.number().int().nonnegative(),
  effects: z.partialRecord(EffectNameSchema, z.number()),
  limitation: luaArray(z.string()),
  limitationBlacklist: luaArray(z.string()),
  iconPath: z.string().default(''),
})

export const BeaconEntitySchema = z.object({
  id: z.string(),
  name: z.string(),
  iconPath: z.string(),
  hidden: z.boolean().default(false),
  moduleSlots: z.number().int().nonnegative(),
  distributionEfficiency: z.number().min(0),
  allowedEffects: z.array(EffectNameSchema),
})

export const TechnologyIngredientSchema = z.object({
  itemId: z.string(),
  amount: z.number().positive(),
})

export const TechnologyCostSchema = z.object({
  ingredients: luaArray(TechnologyIngredientSchema),
  /** null when the count is a formula (count_formula). */
  count: z.number().positive().nullable(),
  time: z.number().nonnegative(),
})

export const ResearchTriggerSchema = z.object({
  /** Factorio trigger type, e.g. 'craft-item'. Any string; unknown types render as plain "Trigger". */
  type: z.string(),
  item: z.string().optional(), // craft-item, send-item-to-orbit
  entity: z.string().optional(), // mine-entity, build-entity, capture-spawner
  fluid: z.string().optional(), // craft-fluid
  /** craft-item / build-entity count; craft-fluid amount. Absent = 1. */
  count: z.number().positive().optional(),
})

export const TechnologySchema = z.object({
  id: z.string(),
  name: z.string(),
  prerequisites: luaArray(z.string()),
  unlockedRecipes: luaArray(z.string()),
  iconPath: z.string().default(''),
  /** undefined = bundle exported without cost; null = not researched in labs (research trigger). */
  cost: TechnologyCostSchema.nullable().optional(),
  /** Research trigger condition. The exporter writes it only when `cost` is null; the UI shows it only then and ignores it when `cost` is non-null. */
  trigger: ResearchTriggerSchema.optional(),
})

export const GameDataSchema = z.object({
  factorioVersion: z.string(),
  modSet: z.record(z.string(), z.string()),
  items: z.record(z.string(), ItemSchema),
  recipes: z.record(z.string(), RecipeSchema),
  machines: z.record(z.string(), MachineSchema),
  modules: z.record(z.string(), ModuleSchema),
  beacons: z.record(z.string(), BeaconEntitySchema).default({}),
  defaultMachines: z.record(z.string(), z.string()),
  /**
   * Runtime-only overlay, never exported: machine id -> the fuel item id a burner row burns by default, when that
   * differs from the lowest-value accepted fuel. Derived from the research horizon by `horizonDefaultFuels`;
   * absent means the unrestricted default.
   */
  defaultFuels: z.record(z.string(), z.string()).optional(),
  /** Crafting category id -> English name (`recipe-category` locale). Absent ids are labelled from the id by `categoryLabel`. */
  categoryNames: z.record(z.string(), z.string()).optional(),
  itemGroups: z.record(z.string(), ItemGroupSchema).default({}),
  itemSubgroups: z.record(z.string(), ItemSubgroupSchema).default({}),
  technologies: z.record(z.string(), TechnologySchema).default({}),
  /** Recipes available without research (dump: recipe.enabled !== false). */
  startingRecipes: luaArray(z.string()).default([]),
})

// ---------------------------------------------------------------------------
// Plan schemas
// ---------------------------------------------------------------------------

export const ProductSchema = z
  .object({
    id: z.string(),
    itemId: z.string(),
    /** Extra output, items/min, made beyond what other blocks request; absent = only what is requested. */
    extraRate: z.preprocess(v => (v === 0 ? undefined : v), z.number().positive().optional()),
  })
  // A saved 0 parses to a present-but-undefined key; keep the key truly absent.
  .transform(p => {
    if (p.extraRate === undefined) delete p.extraRate
    return p
  })

export const ModuleConfigSchema = z.object({
  moduleId: z.string(),
  count: z.number().int().positive(),
})

export const BeaconConfigSchema = z.object({
  beaconId: z.string().optional(),
  moduleId: z.string().optional(),
  beaconCount: z.number().int().nonnegative(),
  modulesPerBeacon: z.number().int().positive(),
  distributionEfficiency: z.number().min(0),
})

export const GameRecipeNodeSchema = z.object({
  kind: z.literal('game-recipe'),
  id: z.string(),
  recipeId: z.string(),
  machineId: z.string().optional(),
  modules: z.array(ModuleConfigSchema),
  // Beacon configurations around the machine, summed by the solver. Absent means no beacon: the store
  // removes the key when the last one goes and the load migration drops an empty list (see migrateRecipeNode).
  // Plans saved with the former single `beaconConfig` are migrated on load too.
  beaconConfigs: z.array(BeaconConfigSchema).optional(),
  // Coerce 0 → undefined so a plan saved with pinnedRate=0 (produced by
  // clicking pin while throughput is 0) still loads correctly.
  pinnedRate: z.preprocess(v => (v === 0 ? undefined : v), z.number().positive().optional()),
  // Reactor rows: average adjacent working reactors per reactor; heat × (1 + Machine.neighbourBonus ×
  // neighbourCount); ignored when the machine has no neighbourBonus; 0 → undefined.
  neighbourCount: z.preprocess(v => (v === 0 ? undefined : v), z.number().nonnegative().optional()),
  byproductPolicy: z.record(z.string(), z.enum(['discard', 'feed-back'])),
  primaryProduct: z.string().optional(),
  byproductConsumer: z.boolean().optional(),
  // Burner rows: the fuel item burnt. An id the machine does not accept is ignored (kept, like
  // defaultMachineOverrides); absent = the lowest-value accepted fuel (see src/data/fuel.ts).
  fuelItemId: z.string().optional(),
})

export const SubPlanNodeSchema = z.object({
  kind: z.literal('subplan'),
  id: z.string(),
  subPlanId: z.string(),
})

/**
 * Load-time migration of one recipe node, pure and idempotent. Injects `kind: 'game-recipe'` on legacy
 * data that lacks the field, and turns the former single `beaconConfig` into the one-element list
 * `beaconConfigs` (a non-empty list wins when both are present). An empty list is dropped, so "no beacon"
 * is always an absent key, and it does not hide a legacy value. Invalid legacy values are wrapped as they
 * are, so the schema rejects them as it did before.
 */
export function migrateRecipeNode(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data
  const node: Record<string, unknown> = { ...data }
  if (!('kind' in node)) return migrateRecipeNode({ kind: 'game-recipe', ...node })
  if (Array.isArray(node.beaconConfigs) && node.beaconConfigs.length === 0) delete node.beaconConfigs
  if ('beaconConfig' in node) {
    const legacy = node.beaconConfig
    delete node.beaconConfig
    if (node.beaconConfigs === undefined && legacy !== undefined) node.beaconConfigs = [legacy]
  }
  return node
}

export const RecipeNodeSchema = z.preprocess(
  migrateRecipeNode,
  z.discriminatedUnion('kind', [GameRecipeNodeSchema, SubPlanNodeSchema]),
)

// SubPlan is recursive, so the TypeScript type is defined manually first, then
// the Zod schema is annotated with it so z.lazy() can reference it correctly.
//
// SubPlans organise rows — they have no goals and no noImportItems. The solver
// flattens every RecipeNode in the tree into a single global LP per Block, except
// that a SubPlan with `area: true` is a separate area in that LP: its rows serve it
// first. Absent and `false` mean the same; turning the flag off removes the key.
type SubPlanType = {
  id: string
  name: string
  nodes: z.output<typeof RecipeNodeSchema>[]
  subPlans: SubPlanType[]
  area?: boolean
  createdAt: string
  updatedAt: string
}

export const SubPlanSchema: z.ZodType<SubPlanType, unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    nodes: z.array(RecipeNodeSchema),
    subPlans: z.array(SubPlanSchema),
    area: z.boolean().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
)

// ---------------------------------------------------------------------------
// Block migration — hoist legacy per-subplan goals and noImportItems to block
// level, and rename block-level `goals`/`rate` to `products`/`extraRate`.
// Preserves backwards-compat for plans saved before subplans were flattened
// into one global LP, and before goals became products.
//
// Walks the raw rootPlan tree, collects goals (deduping by itemId, summing
// rates) and noImportItems (deduping via Set), surfaces them at block level
// as products, and strips them from each subplan in the returned shape.
// ---------------------------------------------------------------------------

interface RawLegacyGoal { id?: unknown; itemId?: unknown; rate?: unknown }
interface RawSubPlan {
  goals?: unknown
  noImportItems?: unknown
  subPlans?: unknown
  [key: string]: unknown
}

/** Legacy block-level goal `{ id, itemId, rate }` → product `{ id, itemId, extraRate }`. */
function legacyGoalToProduct(g: unknown): unknown {
  if (typeof g !== 'object' || g === null) return g
  const { rate, ...rest } = g as Record<string, unknown>
  return rate === undefined ? rest : { ...rest, extraRate: rate }
}

function migrateBlock(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input
  const data = input as Record<string, unknown>
  if (typeof data.rootPlan !== 'object' || data.rootPlan === null) return input

  const collectedGoals = new Map<string, { id: string; itemId: string; extraRate: number }>()
  const collectedNoImports = new Set<string>()

  function visit(plan: RawSubPlan): RawSubPlan {
    if (Array.isArray(plan.goals)) {
      for (const g of plan.goals as RawLegacyGoal[]) {
        if (typeof g?.itemId !== 'string') continue
        if (typeof g?.rate !== 'number' || !(g.rate > 0)) continue
        const existing = collectedGoals.get(g.itemId)
        if (existing) {
          existing.extraRate += g.rate
        } else {
          collectedGoals.set(g.itemId, {
            id: typeof g.id === 'string' ? g.id : crypto.randomUUID(),
            itemId: g.itemId,
            extraRate: g.rate,
          })
        }
      }
    }
    if (Array.isArray(plan.noImportItems)) {
      for (const itemId of plan.noImportItems as unknown[]) {
        if (typeof itemId === 'string') collectedNoImports.add(itemId)
      }
    }
    const { goals: _g, noImportItems: _n, subPlans, ...rest } = plan
    void _g; void _n
    const visitedSubPlans = Array.isArray(subPlans)
      ? (subPlans as RawSubPlan[]).map(sp =>
          visit(typeof sp === 'object' && sp !== null ? sp : ({} as RawSubPlan)),
        )
      : []
    return { ...rest, subPlans: visitedSubPlans }
  }

  const migratedRoot = visit(data.rootPlan as RawSubPlan)

  // Block-level products/noImportItems on the input take precedence over
  // hoisted ones (re-saved migrated plans pass through unchanged). Legacy
  // block-level goals come next, then goals hoisted from sub-plans.
  const products = Array.isArray(data.products) && data.products.length > 0
    ? data.products
    : Array.isArray(data.goals) && data.goals.length > 0
      ? data.goals.map(legacyGoalToProduct)
      : [...collectedGoals.values()]
  const blockNoImports = Array.isArray(data.noImportItems) && data.noImportItems.length > 0
    ? data.noImportItems
    : [...collectedNoImports]

  const {
    goals: _legacy, connectionsFirstItems: _cf, noImportItems: _ni, itemSourcing: _is, ...restWithoutGoals
  } = data
  void _legacy; void _cf; void _ni; void _is

  const sourceRules = migrateSourceRules(data, blockNoImports)

  return {
    ...restWithoutGoals,
    products,
    ...(sourceRules === undefined ? {} : { sourceRules }),
    rootPlan: migratedRoot,
  }
}

/** A rule from a saved `sourceRules` with what it cannot hold dropped: an unknown `makeHere`, an `importOff` that is not true. */
function sanitizeRule(raw: unknown): { makeHere?: 'after-blocks' | 'off'; importOff?: true } | undefined {
  if (!isRecord(raw)) return undefined
  const rule: { makeHere?: 'after-blocks' | 'off'; importOff?: true } = {}
  if (raw.makeHere === 'after-blocks' || raw.makeHere === 'off') rule.makeHere = raw.makeHere
  if (raw.importOff === true) rule.importOff = true
  return rule
}

/**
 * The block's `sourceRules` from whatever it was saved with. A present `sourceRules` wins and the legacy keys
 * are ignored (idempotent); its rules lose any key they cannot hold, as a legacy entry with an unknown mode does.
 * Otherwise: `itemSourcing` entries (or the older `connectionsFirstItems`), in key order, then the remaining
 * `noImportItems`. A 'byproducts-first' preset on a locked item is dropped (the lock won in the solver, so the
 * plan keeps its numbers). Undefined lets the schema default apply; a malformed container (not an object, or a
 * block-level `noImportItems` with a non-string) is passed through to be rejected like any malformed field.
 */
function migrateSourceRules(data: Record<string, unknown>, noImports: unknown[]): unknown {
  if (data.sourceRules !== undefined) {
    if (!isRecord(data.sourceRules)) return data.sourceRules
    const out: Record<string, unknown> = {}
    for (const [id, raw] of Object.entries(data.sourceRules)) {
      const rule = sanitizeRule(raw)
      if (rule) out[id] = rule
    }
    return out
  }
  if (data.itemSourcing !== undefined && !isRecord(data.itemSourcing)) return data.itemSourcing
  if (noImports.some(i => typeof i !== 'string')) return noImports
  const locked = new Set(noImports as string[])
  const out: Record<string, { makeHere?: 'after-blocks' | 'off'; importOff?: true }> = {}
  const modes: [string, unknown][] = isRecord(data.itemSourcing)
    ? Object.entries(data.itemSourcing)
    : Array.isArray(data.connectionsFirstItems)
      ? data.connectionsFirstItems.filter((i): i is string => typeof i === 'string').map(i => [i, 'connections-first'])
      : []
  for (const [id, mode] of modes) {
    const rule: { makeHere?: 'after-blocks' | 'off'; importOff?: true } = {}
    if (mode === 'connections-first' || (mode === 'byproducts-first' && !locked.has(id))) rule.makeHere = makeHereOf(mode)
    if (locked.has(id)) rule.importOff = true
    if (rule.makeHere || rule.importOff) out[id] = rule
  }
  for (const id of locked) if (!Object.hasOwn(out, id)) out[id] = { importOff: true }
  return out
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Legacy `pull: true` connections: the consumer's demand drove the source's goal. A connection is
 * now a request when its item is a product of the source, so a pull to a source that has no product
 * for the item gets one (without extra). Pulls that would not have been applied are left alone:
 * duplicates, self-connections, missing sources, sources that already have the product, and sources
 * that receive the item themselves. Pure: the raw input is never mutated.
 */
function migrateLegacyPulls(raw: unknown): unknown {
  if (!isRecord(raw) || !Array.isArray(raw.blocks)) return raw
  const blocks = raw.blocks.map(b => {
    const m = migrateBlock(b)
    return isRecord(m) ? { ...m } : m
  })
  const byId = new Map<string, Record<string, unknown>>()
  for (const b of blocks) {
    if (isRecord(b) && typeof b.id === 'string' && !byId.has(b.id)) byId.set(b.id, b)
  }
  const connectionsOf = (b: Record<string, unknown>): Record<string, unknown>[] =>
    Array.isArray(b.inputConnections) ? b.inputConnections.filter(isRecord) : []

  for (const consumer of blocks) {
    if (!isRecord(consumer)) continue
    const seen = new Set<string>()
    for (const c of connectionsOf(consumer)) {
      if (typeof c.itemId !== 'string' || typeof c.fromBlockId !== 'string') continue
      const key = `${c.fromBlockId}\0${c.itemId}`
      const duplicate = seen.has(key)
      seen.add(key)
      if (c.pull !== true || duplicate) continue
      if (c.fromBlockId === consumer.id) continue
      const source = byId.get(c.fromBlockId)
      if (!source) continue
      const itemId = c.itemId
      const products = Array.isArray(source.products) ? source.products : []
      if (products.some(p => isRecord(p) && p.itemId === itemId)) continue
      const receives = connectionsOf(source).some(
        sc => sc.itemId === itemId
          && typeof sc.fromBlockId === 'string'
          && sc.fromBlockId !== source.id
          && byId.has(sc.fromBlockId),
      )
      if (receives) continue
      source.products = [...products, { id: crypto.randomUUID(), itemId }]
    }
  }
  return { ...raw, blocks }
}

export const BlockConnectionSchema = z
  .object({
    id: z.string(),
    itemId: z.string(),
    /** Block whose net output of itemId supplies this block. */
    fromBlockId: z.string(),
    /** Most this consumer takes over this connection, items/min; absent = no limit. */
    maxRate: z.preprocess(v => (v === 0 ? undefined : v), z.number().positive().optional()),
  })
  // A saved 0 parses to a present-but-undefined key; keep the key truly absent.
  .transform(c => {
    if (c.maxRate === undefined) delete c.maxRate
    return c
  })

/** How a block sources one item. An absent key is never written; an item with no entry has the default rule (Make it here, Import on). */
export const SourceRuleSchema = z
  .object({
    /** Where "Make more here" sits. Absent: before the block lines (Make it here). */
    makeHere: z.enum(['after-blocks', 'off']).optional(),
    /** Present: the Import line is off. */
    importOff: z.literal(true).optional(),
  })
  .transform(r => {
    const out: { makeHere?: 'after-blocks' | 'off'; importOff?: true } = {}
    if (r.makeHere !== undefined) out.makeHere = r.makeHere
    if (r.importOff !== undefined) out.importOff = r.importOff
    return out
  })

/**
 * One place in an item's served list: a consumer block, or the block's own extra output. An object so a later
 * phase can add kinds. A malformed entry rejects the plan load.
 */
export const ServedEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('block'), blockId: z.string().min(1) }),
  z.object({ kind: z.literal('extra') }),
])

/** itemId → the entries in the order the item is served. Absent key = today's order; a list is never stored empty. */
export const ServedOrderSchema = z.record(z.string(), z.array(ServedEntrySchema))

/** `servedOrder` with duplicate entries dropped (first kept) and emptied lists removed; undefined when nothing is left. Entries for unknown blocks stay (the solver ignores them). */
function normalizeServedOrder(order: z.output<typeof ServedOrderSchema> | undefined): z.output<typeof ServedOrderSchema> | undefined {
  if (order === undefined) return undefined
  const out: z.output<typeof ServedOrderSchema> = {}
  for (const [itemId, list] of Object.entries(order)) {
    const seen = new Set<string>()
    const kept = list.filter(e => {
      const key = e.kind === 'block' ? `block:${e.blockId}` : 'extra'
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (kept.length > 0) Object.defineProperty(out, itemId, { value: kept, enumerable: true, writable: true, configurable: true })
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export const BlockSchema = z.preprocess(
  migrateBlock,
  z.object({
    id: z.string(),
    name: z.string(),
    /** Display colour, `#rrggbb`; filled in by `AppStateSchema` when missing. */
    color: z.string().regex(HEX_COLOR_RE),
    /** The colour follows the icon of the first product (the store recolours the block when it changes); absent or false once the user picks a colour, as in plans saved before it existed. */
    colorAuto: z.boolean().optional(),
    products: z.array(ProductSchema).default([]),
    /** itemId → the item's source rule; an item with no entry has the default rule. A rule with no key is dropped on load. */
    sourceRules: z
      .record(z.string(), SourceRuleSchema)
      .transform(rules => Object.fromEntries(Object.entries(rules).filter(([, r]) => r.makeHere !== undefined || r.importOff !== undefined)))
      .default({}),
    /** Inbound connections: items this block receives from other blocks' output. */
    inputConnections: z.array(BlockConnectionSchema).default([]),
    /** itemId → the consumers (and the extra output) in the order they are served; absent = today's order. */
    servedOrder: ServedOrderSchema.optional(),
    rootPlan: SubPlanSchema,
  }),
).transform(block => {
  // Sub-plans stored under a plan other than the one holding their handle (see reparentSubPlans).
  const rootPlan = reparentSubPlans(block.rootPlan)
  // The served list is normalised here; the key stays truly absent when there is none.
  const { servedOrder, ...rest } = block
  const served = normalizeServedOrder(servedOrder)
  return { ...rest, rootPlan, ...(served === undefined ? {} : { servedOrder: served }) }
})

export const AppStateSchema = z.preprocess(
  // Per-block migration cannot see the other blocks, so colours are handed out here, and legacy
  // pulls (which add a product to their source) are migrated after block migration hoisted products.
  raw => migrateLegacyPulls(assignMissingBlockColors(raw)),
  z.object({
    blocks: z.array(BlockSchema),
    activeBlockId: z.string(),
    /** Technologies the plan targets; their prerequisites are implied. Empty = no limit. */
    horizonTechnologyIds: z.array(z.string()).default([]),
    /** User-chosen default machine per crafting category (category -> machine id). Layered over the
     *  horizon defaults; an override that is unknown, hidden, cannot craft the category or is outside
     *  the horizon is ignored but kept. */
    defaultMachineOverrides: z.record(z.string(), z.string()).default({}),
  }),
)

/** Data set an exported plan was made for; only in exported files, never in localStorage. */
export const PlanDataSetStampSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  factorioVersion: z.string().optional(),
})

/** One saved plan of a data set, as listed in its plan index. */
export const PlanEntrySchema = z.object({ id: z.string().min(1), name: z.string() })

/** The plans saved for one data set, and which of them is active. */
export const PlanIndexSchema = z.object({ activePlanId: z.string(), plans: z.array(PlanEntrySchema) })

// ---------------------------------------------------------------------------
// Canonical types — derived from the schema, not written by hand.
//
// These are the single source of truth for the shape of parsed game data and
// plans. Downstream code (types.ts, loader.ts, solver, UI) must import from
// here rather than maintaining parallel handwritten interfaces.
//
// z.output<T> reflects post-transform values (e.g. mainProduct "" → null).
// z.input<T>  reflects what the schema accepts before transforms (used in tests
//             to construct valid raw objects).
// ---------------------------------------------------------------------------

export type Item = z.output<typeof ItemSchema>
export type Ingredient = z.output<typeof IngredientSchema>
export type RecipeProduct = z.output<typeof RecipeProductSchema>
export type Recipe = z.output<typeof RecipeSchema>
export type EffectName = z.output<typeof EffectNameSchema>
export type Machine = z.output<typeof MachineSchema>
export type Module = z.output<typeof ModuleSchema>
export type BeaconEntity = z.output<typeof BeaconEntitySchema>
export type ItemGroup = z.output<typeof ItemGroupSchema>
export type ItemSubgroup = z.output<typeof ItemSubgroupSchema>
export type Technology = z.output<typeof TechnologySchema>
export type TechnologyCost = z.output<typeof TechnologyCostSchema>
export type ResearchTrigger = z.output<typeof ResearchTriggerSchema>
export type GameData = z.output<typeof GameDataSchema>

export type Product = z.output<typeof ProductSchema>
export type ModuleConfig = z.output<typeof ModuleConfigSchema>
export type BeaconConfig = z.output<typeof BeaconConfigSchema>
export type RecipeNode = z.output<typeof RecipeNodeSchema>
export type GameRecipeNode = z.output<typeof GameRecipeNodeSchema>
export type SubPlanNode = z.output<typeof SubPlanNodeSchema>
export type SubPlan = SubPlanType
export type BlockConnection = z.output<typeof BlockConnectionSchema>
export type SourceRule = z.output<typeof SourceRuleSchema>
export type ServedEntry = z.output<typeof ServedEntrySchema>
export type Block = z.output<typeof BlockSchema>
export type AppState = z.output<typeof AppStateSchema>
export type PlanDataSetStamp = z.output<typeof PlanDataSetStampSchema>
export type PlanEntry = z.output<typeof PlanEntrySchema>
export type PlanIndex = z.output<typeof PlanIndexSchema>

// Input types — what the schema accepts before transforms (useful in tests).
export type GameDataInput = z.input<typeof GameDataSchema>
