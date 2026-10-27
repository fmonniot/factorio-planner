import { z } from 'zod'
import { HEX_COLOR_RE, assignMissingBlockColors } from './blockColors'
import { reparentSubPlans } from './subPlanTree'

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
  hidden: z.boolean().default(false),
  stackSize: z.number().int().positive().optional(),
  subgroup: z.string().default(''),
  order: z.string().default(''),
  /** Id of the machine or beacon this item places (prototype `place_result`); only set when it names a machine or beacon in the bundle. */
  placeResult: z.string().optional(),
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
  type: z.enum(['assembling-machine', 'furnace', 'rocket-silo', 'mining-drill', 'offshore-pump']),
  // Some older exports omit this field. Default to 1 so they still load;
  // re-export to get real values.
  craftingSpeed: z.number().positive().default(1),
  energyUsageKw: z.number().nonnegative(),
  energyType: z.enum(['electric', 'burner', 'heat', 'void']),
  drainKw: z.number().nonnegative(),
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

export const TechnologySchema = z.object({
  id: z.string(),
  name: z.string(),
  prerequisites: luaArray(z.string()),
  unlockedRecipes: luaArray(z.string()),
  iconPath: z.string().default(''),
  /** undefined = bundle exported without cost; null = not researched in labs (research trigger). */
  cost: TechnologyCostSchema.nullable().optional(),
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
  moduleId: z.string(),
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
  beaconConfig: BeaconConfigSchema.optional(),
  // Coerce 0 → undefined so a plan saved with pinnedRate=0 (produced by
  // clicking pin while throughput is 0) still loads correctly.
  pinnedRate: z.preprocess(v => (v === 0 ? undefined : v), z.number().positive().optional()),
  byproductPolicy: z.record(z.string(), z.enum(['discard', 'feed-back'])),
  primaryProduct: z.string().optional(),
  byproductConsumer: z.boolean().optional(),
})

export const SubPlanNodeSchema = z.object({
  kind: z.literal('subplan'),
  id: z.string(),
  subPlanId: z.string(),
})

// Preprocess injects kind: 'game-recipe' on legacy data that lacks the field,
// enabling backwards-compatible loading of persisted plans.
export const RecipeNodeSchema = z.preprocess(
  data => {
    if (typeof data === 'object' && data !== null && !('kind' in data))
      return { kind: 'game-recipe', ...data }
    return data
  },
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

  const { goals: _legacy, connectionsFirstItems: _cf, ...restWithoutGoals } = data
  void _legacy; void _cf

  const itemSourcing = migrateItemSourcing(data)

  return {
    ...restWithoutGoals,
    products,
    noImportItems: blockNoImports,
    ...(itemSourcing === undefined ? {} : { itemSourcing }),
    rootPlan: migratedRoot,
  }
}

/** A saved map keeps its entries with a known mode (an unknown one loads as own recipes first); without a map,
 *  legacy `connectionsFirstItems` become 'connections-first' entries. Undefined lets the schema default apply. */
function migrateItemSourcing(data: Record<string, unknown>): unknown {
  if (isRecord(data.itemSourcing))
    return Object.fromEntries(Object.entries(data.itemSourcing).filter(([, m]) => ItemSourcingModeSchema.safeParse(m).success))
  if (data.itemSourcing === undefined && Array.isArray(data.connectionsFirstItems)) {
    const out: Record<string, string> = {}
    for (const id of data.connectionsFirstItems) if (typeof id === 'string') out[id] = 'connections-first'
    return out
  }
  return data.itemSourcing // undefined -> default {}; anything else (array, string, null) -> rejected by the schema, like any malformed field
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

/** How a block sources an item; an absent entry means own recipes first. */
export const ItemSourcingModeSchema = z.enum(['byproducts-first', 'connections-first'])
export const ItemSourcingSchema = z.record(z.string(), ItemSourcingModeSchema)

export const BlockSchema = z.preprocess(
  migrateBlock,
  z.object({
    id: z.string(),
    name: z.string(),
    /** Display colour, `#rrggbb`; filled in by `AppStateSchema` when missing. */
    color: z.string().regex(HEX_COLOR_RE),
    products: z.array(ProductSchema).default([]),
    /** Items the LP solver must not import as raw inputs (no slack variable). */
    noImportItems: z.array(z.string()).default([]),
    /** itemId → how the block sources it; absent = own recipes first. */
    itemSourcing: ItemSourcingSchema.default({}),
    /** Inbound connections: items this block receives from other blocks' output. */
    inputConnections: z.array(BlockConnectionSchema).default([]),
    rootPlan: SubPlanSchema,
  }),
).transform(block => {
  // Sub-plans stored under a plan other than the one holding their handle (see reparentSubPlans).
  const rootPlan = reparentSubPlans(block.rootPlan)
  return rootPlan === block.rootPlan ? block : { ...block, rootPlan }
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
export type GameData = z.output<typeof GameDataSchema>

export type Product = z.output<typeof ProductSchema>
export type ModuleConfig = z.output<typeof ModuleConfigSchema>
export type BeaconConfig = z.output<typeof BeaconConfigSchema>
export type RecipeNode = z.output<typeof RecipeNodeSchema>
export type GameRecipeNode = z.output<typeof GameRecipeNodeSchema>
export type SubPlanNode = z.output<typeof SubPlanNodeSchema>
export type SubPlan = SubPlanType
export type BlockConnection = z.output<typeof BlockConnectionSchema>
export type ItemSourcingMode = z.output<typeof ItemSourcingModeSchema>
export type ItemSourcing = z.output<typeof ItemSourcingSchema>
export type Block = z.output<typeof BlockSchema>
export type AppState = z.output<typeof AppStateSchema>
export type PlanDataSetStamp = z.output<typeof PlanDataSetStampSchema>
export type PlanEntry = z.output<typeof PlanEntrySchema>
export type PlanIndex = z.output<typeof PlanIndexSchema>

// Input types — what the schema accepts before transforms (useful in tests).
export type GameDataInput = z.input<typeof GameDataSchema>
