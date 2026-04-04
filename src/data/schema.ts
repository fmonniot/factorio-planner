import { z } from 'zod'

// ---------------------------------------------------------------------------
// Game Data schemas
// ---------------------------------------------------------------------------

export const ItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['item', 'fluid']),
  iconPath: z.string(),
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
  ingredients: z.array(IngredientSchema),
  products: z.array(ProductSchema),
  madeIn: z.array(z.string()),
  allowProductivity: z.boolean(),
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
  craftingSpeed: z.number().positive(),
  energyUsageKw: z.number().nonnegative(),
  energyType: z.enum(['electric', 'burner', 'heat', 'void']),
  drainKw: z.number().nonnegative(),
  moduleSlots: z.number().int().nonnegative(),
  allowedEffects: z.array(EffectNameSchema),
  craftingCategories: z.array(z.string()),
  iconPath: z.string(),
})

export const ModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  tier: z.number().int().nonnegative(),
  effects: z.record(EffectNameSchema, z.number()),
  limitation: z.array(z.string()),
  limitationBlacklist: z.array(z.string()),
})

export const GameDataSchema = z.object({
  factorioVersion: z.string(),
  modSet: z.record(z.string(), z.string()),
  items: z.record(z.string(), ItemSchema),
  recipes: z.record(z.string(), RecipeSchema),
  machines: z.record(z.string(), MachineSchema),
  modules: z.record(z.string(), ModuleSchema),
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
  moduleId: z.string(),
  beaconCount: z.number().int().nonnegative(),
  modulesPerBeacon: z.number().int().positive(),
  distributionEfficiency: z.number().min(0).max(1),
})

export const RecipeNodeSchema = z.object({
  id: z.string(),
  recipeId: z.string(),
  machineId: z.string().optional(),
  modules: z.array(ModuleConfigSchema),
  beaconConfig: BeaconConfigSchema.optional(),
  pinnedRate: z.number().positive().optional(),
  byproductPolicy: z.record(z.string(), z.enum(['discard', 'feed-back'])),
})

export const PlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  gameDataVersion: z.string(),
  goals: z.array(ProductionGoalSchema),
  nodes: z.array(RecipeNodeSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
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
export type GameData = z.output<typeof GameDataSchema>

export type ProductionGoal = z.output<typeof ProductionGoalSchema>
export type ModuleConfig = z.output<typeof ModuleConfigSchema>
export type BeaconConfig = z.output<typeof BeaconConfigSchema>
export type RecipeNode = z.output<typeof RecipeNodeSchema>
export type Plan = z.output<typeof PlanSchema>

// Input types — what the schema accepts before transforms (useful in tests).
export type GameDataInput = z.input<typeof GameDataSchema>
export type PlanInput = z.input<typeof PlanSchema>
