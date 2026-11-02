import { z } from 'zod'
import { PlanDataSetStampSchema } from '../data/schema'

// ---------------------------------------------------------------------------
// The in-game viewer snapshot: a projection of the planner's state (plan + solver
// result), not the stored plan. Defined once here; `contract/snapshot.schema.json`
// is generated from it and the Lua and Rust sides test against that and the fixtures
// in `contract/fixtures/`. See initiatives/archive/in-game-viewer/plan.md ("What is sent").
//
// Rules of the shape:
// - Ids are the ones the game knows. No icons, no display names of game objects.
//   (Block and sub-factory names are the player's own text, not game objects.) Ids the data
//   exporter invented (`mining:*`, `offshore:*`, `power:*` recipes, the `power:electricity`
//   and `power:heat` items) never appear: such a row carries a `kind` and its `product` instead of a recipe,
//   and electricity and heat are `virtual` references that the reader draws itself.
// - JSON `null` never appears: an absent value is an omitted key.
// - Rates are items per minute, rounded to three decimals.
// - Blocks' sub-factory groups are referred to by their index in the block's `groups`, so a
//   snapshot carries no planner ids.
// - It holds what the in-game table draws and nothing else: no warnings, no connections between
//   blocks and no power. The web planner is where those are dealt with.
// ---------------------------------------------------------------------------

/** Bumped when a change to the shape could break a reader of the previous version. */
export const SNAPSHOT_VERSION = 1

const rate = z.number().nonnegative()
const count = z.number().int().nonnegative()
const index = z.number().int().nonnegative()

/** The ids of the `virtual` items, the electricity and heat pseudo-items (`ELECTRICITY_ITEM_ID` and `HEAT_ITEM_ID` in the plan). */
export const SNAPSHOT_ELECTRICITY_ID = 'electricity'
export const SNAPSHOT_HEAT_ID = 'heat'

/**
 * `item` and `fluid` pick the sprite prefix (`item/<id>`, `fluid/<id>`). `virtual` is not a game
 * prototype: the reader exempts it from the id check and draws it itself.
 */
const itemType = z.enum(['item', 'fluid', 'virtual'])

/** A reference to an item, a fluid or a virtual item (electricity, heat). */
export const SnapshotItemRefSchema = z.strictObject({
  id: z.string().min(1),
  type: itemType,
})

/** An item reference with a rate, items/min. */
export const SnapshotItemRateSchema = z.strictObject({
  id: z.string().min(1),
  type: itemType,
  rate,
})

/** A module (an item) and how many of it a machine holds. */
export const SnapshotModuleSchema = z.strictObject({
  id: z.string().min(1),
  count: z.number().int().positive(),
})

/** The beacons of a row: the beacon entity, how many per machine, and the module and how many of it each beacon holds. */
export const SnapshotBeaconSchema = z.strictObject({
  id: z.string().min(1),
  count: z.number().int().positive(),
  module: z.string().min(1),
  modules: z.number().int().positive(),
})

/**
 * What every row carries. The row mirrors the plan, so the solved values are optional: they are
 * omitted for a row the solve did not value (a failed block, a recipe the data set lacks) and for
 * a value that is not a finite non-negative number.
 */
const rowShape = {
  /** The machine the row uses: its own, else the default the solver used; absent when there is none. */
  machine: z.string().min(1).optional(),
  /** Index into the block's `groups`: the innermost sub-factory the row sits in; absent for a row of the root plan. */
  group: index.optional(),
  /** Machines needed, exact. */
  machines: rate.optional(),
  /** Machines needed, rounded up. */
  machinesCeil: count.optional(),
  /** Recipe executions per minute. */
  throughput: rate.optional(),
  /** Items consumed per minute, from the solve; omitted when empty or when the row is unsolved. Electricity and heat are left out. */
  inputs: z.array(SnapshotItemRateSchema).optional(),
  /** Items produced per minute (gross), from the solve; same rules as `inputs`. */
  outputs: z.array(SnapshotItemRateSchema).optional(),
  /** The machine's own modules (slots with an empty module id are skipped); omitted when it holds none. */
  modules: z.array(SnapshotModuleSchema).optional(),
  /** Omitted when the row has no beacon config, no beacon entity, no beacon module or no beacon. */
  beacon: SnapshotBeaconSchema.optional(),
}

/** A row of a game recipe. The id is sent as it is in the plan, even when the data set lacks it. */
export const SnapshotGameRowSchema = z.strictObject({
  recipe: z.string().min(1),
  ...rowShape,
})

/** A row of a recipe the exporter invented: no recipe id, its kind and main product instead. */
export const SnapshotSyntheticRowSchema = z.strictObject({
  kind: z.enum(['mining', 'offshore', 'power']),
  /** The recipe's main product; absent when the data set lacks the recipe. */
  product: SnapshotItemRefSchema.optional(),
  ...rowShape,
})

export const SnapshotRowSchema = z.union([SnapshotGameRowSchema, SnapshotSyntheticRowSchema])

/** A sub-factory (a sub-plan with rows at any depth). */
export const SnapshotGroupSchema = z.strictObject({
  name: z.string(),
  /** Index into the block's `groups` of the enclosing sub-factory, always lower than this group's own index; absent for a top-level one. */
  parent: index.optional(),
  /** True when the sub-factory is a separate area. */
  area: z.literal(true).optional(),
})

export const SnapshotBlockSchema = z.strictObject({
  name: z.string(),
  /** `#rrggbb`. */
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  /** What the block is asked to make: its extra rate plus what other blocks request. */
  products: z.array(SnapshotItemRateSchema),
  /**
   * The sub-factories that hold rows, in pre-order (a parent comes before its children). Present only when there is one.
   * A row's `group` points here. A group's rows are only interrupted by its own descendants, so the rows of `P[a, S, b]`
   * belong to the groups `P, S, P`.
   */
  groups: z.array(SnapshotGroupSchema).optional(),
  /** The plan's recipe rows in table order, whether or not the block solved. */
  rows: z.array(SnapshotRowSchema),
  /** What must come from outside the block, in the solver's `unsatisfied` order. */
  imports: z.array(SnapshotItemRateSchema),
  /** The solver's message when this block's solve failed; then its rows carry no solved values and `imports` is the result's, which the solver leaves empty. */
  error: z.string().optional(),
})

export const SnapshotSchema = z.strictObject({
  v: z.literal(SNAPSHOT_VERSION),
  /** The data set the plan was made for, as in an exported plan. */
  dataSet: z.strictObject(PlanDataSetStampSchema.shape),
  blocks: z.array(SnapshotBlockSchema),
})

export type SnapshotItemRef = z.output<typeof SnapshotItemRefSchema>
export type SnapshotItemRate = z.output<typeof SnapshotItemRateSchema>
export type SnapshotModule = z.output<typeof SnapshotModuleSchema>
export type SnapshotBeacon = z.output<typeof SnapshotBeaconSchema>
export type SnapshotGroup = z.output<typeof SnapshotGroupSchema>
export type SnapshotRow = z.output<typeof SnapshotRowSchema>
export type SnapshotGameRow = z.output<typeof SnapshotGameRowSchema>
export type SnapshotSyntheticRow = z.output<typeof SnapshotSyntheticRowSchema>
export type SnapshotBlock = z.output<typeof SnapshotBlockSchema>
export type Snapshot = z.output<typeof SnapshotSchema>
