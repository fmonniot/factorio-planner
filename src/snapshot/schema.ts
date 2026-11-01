import { z } from 'zod'
import { PlanDataSetStampSchema } from '../data/schema'

// ---------------------------------------------------------------------------
// The in-game viewer snapshot: a projection of the planner's state (plan + solver
// result), not the stored plan. Defined once here; `contract/snapshot.schema.json`
// is generated from it and the Lua and Rust sides test against that and the fixtures
// in `contract/fixtures/`. See initiatives/in-game-viewer/plan.md ("What is sent").
//
// Rules of the shape:
// - Ids are the ones the game knows. No icons, no display names of game objects.
//   (Block and area names are the player's own text, not game objects.)
// - JSON `null` never appears: an absent value is an omitted key.
// - Rates are items per minute, rounded to three decimals.
// - Blocks, and the areas inside a block, are referred to by their index in the
//   arrays below, so a snapshot carries no planner ids.
// ---------------------------------------------------------------------------

/** Bumped when a change to the shape could break a reader of the previous version. */
export const SNAPSHOT_VERSION = 1

const rate = z.number().nonnegative()
const count = z.number().int().nonnegative()
const index = z.number().int().nonnegative()

/** A reference to an item or a fluid; `type` picks the sprite prefix (`item/<id>` or `fluid/<id>`). */
export const SnapshotItemRefSchema = z.strictObject({
  id: z.string().min(1),
  type: z.enum(['item', 'fluid']),
})

/** An item reference with a rate, items/min. */
export const SnapshotItemRateSchema = z.strictObject({
  id: z.string().min(1),
  type: z.enum(['item', 'fluid']),
  rate,
})

/** One recipe row of a block. */
export const SnapshotRowSchema = z.strictObject({
  recipe: z.string().min(1),
  /** The machine the row uses, explicit or the plan's default for the recipe's category; absent when there is none. */
  machine: z.string().min(1).optional(),
  /** Index into the block's `areas`; present only when the block has areas. */
  area: index.optional(),
  /** Machines needed, exact. */
  machines: rate,
  /** Machines needed, rounded up. */
  machinesCeil: count,
  /** Recipe executions per minute. */
  throughput: rate,
  powerKw: rate,
})

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
  type: z.enum(['item', 'fluid']),
  /** items/min this block could take over the connection. */
  available: rate,
})

export const SnapshotBlockSchema = z.strictObject({
  name: z.string(),
  /** `#rrggbb`. */
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  /** What the block is asked to make: its extra rate plus what other blocks request. */
  products: z.array(SnapshotItemRateSchema),
  /** Area names in table order (the root first). Present only when the block has separate areas. */
  areas: z.array(z.string()).optional(),
  /** Recipe rows in table order. Empty for a block whose solve failed. */
  rows: z.array(SnapshotRowSchema),
  /** What must come from outside the block, in the solver's `unsatisfied` order. */
  imports: z.array(SnapshotItemRateSchema),
  warnings: z.array(SnapshotWarningSchema),
  connections: z.array(SnapshotConnectionSchema),
  /** The solver's message when this block's solve failed; then `rows`, `imports` and `warnings` are empty. */
  error: z.string().optional(),
})

export const SnapshotSchema = z.strictObject({
  v: z.literal(SNAPSHOT_VERSION),
  /** The data set the plan was made for, as in an exported plan. */
  dataSet: PlanDataSetStampSchema,
  blocks: z.array(SnapshotBlockSchema),
})

export type SnapshotItemRef = z.output<typeof SnapshotItemRefSchema>
export type SnapshotItemRate = z.output<typeof SnapshotItemRateSchema>
export type SnapshotRow = z.output<typeof SnapshotRowSchema>
export type SnapshotWarning = z.output<typeof SnapshotWarningSchema>
export type SnapshotConnection = z.output<typeof SnapshotConnectionSchema>
export type SnapshotBlock = z.output<typeof SnapshotBlockSchema>
export type Snapshot = z.output<typeof SnapshotSchema>
