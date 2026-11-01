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
//   (Block and area names are the player's own text, not game objects.) Ids the data
//   exporter invented (`mining:*`, `offshore:*`, `power:*` recipes, the `power:electricity`
//   item) never appear: such a row carries a `kind` and its `product` instead of a recipe,
//   and the electricity item is a `virtual` reference that the reader draws itself.
// - JSON `null` never appears: an absent value is an omitted key.
// - Rates are items per minute, rounded to three decimals.
// - Blocks, and the areas and sub-factory groups inside a block, are referred to by their
//   index in the arrays below, so a snapshot carries no planner ids.
// ---------------------------------------------------------------------------

/** Bumped when a change to the shape could break a reader of the previous version. */
export const SNAPSHOT_VERSION = 1

const rate = z.number().nonnegative()
const count = z.number().int().nonnegative()
const index = z.number().int().nonnegative()

/** The id of the one `virtual` item, the electricity pseudo-item (`ELECTRICITY_ITEM_ID` in the plan). */
export const SNAPSHOT_ELECTRICITY_ID = 'electricity'

/**
 * `item` and `fluid` pick the sprite prefix (`item/<id>`, `fluid/<id>`). `virtual` is not a game
 * prototype: the reader exempts it from the id check and draws it itself.
 */
const itemType = z.enum(['item', 'fluid', 'virtual'])

/** A reference to an item, a fluid or the virtual electricity item. */
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
  /** Index into the block's `areas`; present only when the block has areas. */
  area: index.optional(),
  /** Index into the block's `groups`: the innermost sub-factory the row sits in; absent for a row of the root plan. */
  group: index.optional(),
  /** Machines needed, exact. */
  machines: rate.optional(),
  /** Machines needed, rounded up. */
  machinesCeil: count.optional(),
  /** Recipe executions per minute. */
  throughput: rate.optional(),
  powerKw: rate.optional(),
  /** Items consumed per minute, from the solve; omitted when empty or when the row is unsolved. Electricity is left out. */
  inputs: z.array(SnapshotItemRateSchema).optional(),
  /** Items produced per minute (gross), from the solve; same rules as `inputs`. */
  outputs: z.array(SnapshotItemRateSchema).optional(),
  /** The machine's own modules; omitted when it holds none. */
  modules: z.array(SnapshotModuleSchema).optional(),
  /** Omitted when the row has no beacon config, no beacon entity or no beacon. */
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

/**
 * What a warning names. `code` is the solver's warning type; each list holds the ids the warning
 * names, and is omitted when empty. The numbers in the solver's warnings (rates, counts, rounds)
 * are not sent.
 */
export const SnapshotWarningSchema = z.strictObject({
  code: z.enum([
    'no-recipe',
    'duplicate-recipe',
    'infeasible-pins',
    'overconstrained',
    'area-shortfall',
    'loop-not-converged',
    'request-loop-not-converged',
  ]),
  items: z.array(SnapshotItemRefSchema).optional(),
  recipes: z.array(z.string().min(1)).optional(),
  /** Indices into the snapshot's `blocks`. */
  blocks: z.array(index).optional(),
  /** Indices into the block's `areas`. */
  areas: z.array(index).optional(),
})

/** Items a block receives from another block's output. */
export const SnapshotConnectionSchema = z.strictObject({
  /** Index into the snapshot's `blocks` of the supplying block. */
  from: index,
  id: z.string().min(1),
  type: itemType,
  /** items/min this block could take over the connection. */
  available: rate,
})

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
  /** Area names in table order (the root first). Present only when the block has separate areas. */
  areas: z.array(z.string()).optional(),
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
  warnings: z.array(SnapshotWarningSchema),
  connections: z.array(SnapshotConnectionSchema),
  /** The solver's message when this block's solve failed; then its rows carry no solved values. `imports` and `warnings` are the result's, which the solver leaves empty or holding only warnings that name the block, such as a loop that did not converge. */
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
export type SnapshotWarning = z.output<typeof SnapshotWarningSchema>
export type SnapshotConnection = z.output<typeof SnapshotConnectionSchema>
export type SnapshotBlock = z.output<typeof SnapshotBlockSchema>
export type Snapshot = z.output<typeof SnapshotSchema>
