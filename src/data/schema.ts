import { z } from 'zod'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Lua's game.table_to_json serialises empty Lua tables as {} (object) rather
 * than [] (array). This preprocessor normalises empty objects to empty arrays
 * before Zod validates the array schema, so the rest of the schema stays clean.
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
})

export const IngredientSchema = z.object({
  itemId: z.string(),
  type: z.enum(['item', 'fluid']),
  amount: z.number().positive(),
  minimumTemperature: z.number().optional(),
  maximumTemperature: z.number().optional(),
})

export const ProductSchema = z.object({
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
  products: luaArray(ProductSchema),
  madeIn: luaArray(z.string()),
  allowProductivity: z.boolean(),
  hidden: z.boolean().default(false),
  // null = explicitly multi-output with no primary (main_product = "" in Lua export)
  // The Lua exporter emits "" for the multi-output case; we normalise to null here.
  mainProduct: z
    .string()
    .nullable()
    .optional()
    .transform(v => (v === '' ? null : v)),
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
  type: z.enum(['assembling-machine', 'furnace', 'rocket-silo']),
  // Older exports (produced before the Lua script used get_crafting_speed())
  // omit this field. Default to 1 so they still load; re-export to get real values.
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
  effects: z.record(EffectNameSchema, z.number()),
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
  distributionEfficiency: z.number().min(0).max(1),
  allowedEffects: z.array(EffectNameSchema),
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
})

// ---------------------------------------------------------------------------
// Plan schemas
// ---------------------------------------------------------------------------

export const ProductionGoalSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  rate: z.number().positive(),
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
  distributionEfficiency: z.number().min(0).max(1),
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
  // Coerce 0 → undefined so a plan saved with pinnedRate=0 still loads correctly.
  pinnedRate: z.preprocess(v => (v === 0 ? undefined : v), z.number().positive().optional()),
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
type SubPlanType = {
  id: string
  name: string
  goals: z.output<typeof ProductionGoalSchema>[]
  nodes: z.output<typeof RecipeNodeSchema>[]
  subPlans: SubPlanType[]
  /** Items the LP solver must not import as raw inputs (no slack variable). */
  noImportItems: string[]
  createdAt: string
  updatedAt: string
}

export const SubPlanSchema: z.ZodType<SubPlanType, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    goals: z.array(ProductionGoalSchema),
    nodes: z.array(RecipeNodeSchema),
    subPlans: z.array(SubPlanSchema),
    noImportItems: z.array(z.string()).default([]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  }),
)

export const BlockSchema = z.object({
  id: z.string(),
  name: z.string(),
  gameDataVersion: z.string(),
  rootPlan: SubPlanSchema,
})

export const AppStateSchema = z.object({
  blocks: z.array(BlockSchema),
  activeBlockId: z.string(),
})

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
export type Product = z.output<typeof ProductSchema>
export type Recipe = z.output<typeof RecipeSchema>
export type EffectName = z.output<typeof EffectNameSchema>
export type Machine = z.output<typeof MachineSchema>
export type Module = z.output<typeof ModuleSchema>
export type BeaconEntity = z.output<typeof BeaconEntitySchema>
export type GameData = z.output<typeof GameDataSchema>

export type ProductionGoal = z.output<typeof ProductionGoalSchema>
export type ModuleConfig = z.output<typeof ModuleConfigSchema>
export type BeaconConfig = z.output<typeof BeaconConfigSchema>
export type RecipeNode = z.output<typeof RecipeNodeSchema>
export type GameRecipeNode = z.output<typeof GameRecipeNodeSchema>
export type SubPlanNode = z.output<typeof SubPlanNodeSchema>
export type SubPlan = SubPlanType
export type Block = z.output<typeof BlockSchema>
export type AppState = z.output<typeof AppStateSchema>

// Input types — what the schema accepts before transforms (useful in tests).
export type GameDataInput = z.input<typeof GameDataSchema>
