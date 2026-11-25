import type { Block, FluidTag, GameData, SolverResult, ConnectionFlow } from '../../data/types'
import { flowKey, isTemperatureTag, parseFlowKey } from '../../data/flowKey'
import { acceptsTemperature } from '../../data/temperature'
import { areaName } from '../../data/subPlanTree'
import { MISSING_BLOCK_COLOR } from '../../data/blockColors'
import { FLOW_TOLERANCE } from '../../solver/index'
import { flowShares } from './flowParts'
import type { RecipeAreaIndex } from './recipeAreas'
import { showsAsPositive } from './summaryRows'

// ---------------------------------------------------------------------------
// The lines under each output of the side panel: where one product or byproduct of a row goes, from what the solver did. A
// pure function of plain data (like `sourcesModel.ts`); the model carries no unit, the helpers take the rate formatter.
// ---------------------------------------------------------------------------

/** A row of the block that takes the item as an ingredient. */
export interface OutputConsumer {
  /** The row's recipe node id. */
  nodeId: string
  recipeName: string
  /** items/min the row takes. */
  rate: number
  /** The row absorbs a byproduct (`byproductConsumer`). */
  absorber: boolean
  /** The row sits in another area than the one shown: the name of its area. */
  areaName?: string
}

/** Another block that takes the item over a connection. */
export interface OutputReceiver {
  blockId: string
  blockName: string
  /** The block's colour, or the missing-block grey. */
  color: string
  /** items/min delivered. */
  rate: number
  /** Any flow of the sum is a request. */
  requested: boolean
}

export interface OutputModelInput {
  itemId: string
  itemName: string
  /** There is a solve for the block; without one nothing is known about the rates. */
  solved: boolean
  /** items/min the row makes (gross). */
  rate: number
  /** The row's policy for the item is Discard: its output is not counted. */
  discarded: boolean
  /** The item is a product of the block. */
  product: boolean
  consumers: OutputConsumer[]
  receivers: OutputReceiver[]
  /** items/min of the item left over in the block; 0 for none (never set for a product). */
  leftover: number
  /** Other rows of the block that make the item at the moment and count it (a row that discards it does not). */
  otherMakers: number
  /** items/min those other rows make; 0 for none. */
  othersRate: number
}

export type OutputLook = { kind: 'block'; color: string } | { kind: 'made' } | { kind: 'product' } | { kind: 'left' }

export interface OutputLine {
  /** `row:${nodeId}`, `block:${blockId}`, `product` or `left`. */
  key: string
  kind: 'row' | 'block' | 'product' | 'left'
  /** The recipe name, the block name, "Block product" or "Left over". */
  label: string
  /** items/min. */
  rate: number
  look: OutputLook
  absorber: boolean
  areaName?: string
  requested: boolean
}

export interface OutputModel {
  itemId: string
  itemName: string
  solved: boolean
  /** The row's policy is Discard: no lines. */
  discarded: boolean
  /** Solved, not discarded and the row makes none at the moment: no lines. */
  notProduced: boolean
  otherMakers: number
  /** In the order rows, blocks, block product, leftover. */
  lines: OutputLine[]
}

/** A rate worth speaking of: one that shows as more than 0.00/min, so no line reads "0.0". */
function counts(perMin: number): boolean {
  return showsAsPositive(perMin)
}

/** Where the item goes: the rows that use it, the blocks it is sent to, what the block keeps for its goal and what is left over. */
export function buildOutputModel(input: OutputModelInput): OutputModel {
  const { itemId, itemName, solved, rate, discarded, product, consumers, receivers, leftover, otherMakers } = input
  const model: OutputModel = { itemId, itemName, solved, discarded: false, notProduced: false, otherMakers, lines: [] }
  if (!solved) return model
  if (discarded) return { ...model, discarded: true }
  if (!counts(rate)) return { ...model, notProduced: true }

  const lines = model.lines
  for (const c of consumers) {
    lines.push({
      key: `row:${c.nodeId}`, kind: 'row', label: c.recipeName, rate: c.rate, look: { kind: 'made' }, absorber: c.absorber,
      ...(c.areaName !== undefined ? { areaName: c.areaName } : {}), requested: false,
    })
  }
  for (const r of receivers) {
    lines.push({ key: `block:${r.blockId}`, kind: 'block', label: r.blockName, rate: r.rate, look: { kind: 'block', color: r.color }, absorber: false, requested: r.requested })
  }
  if (product) {
    const taken = consumers.reduce((sum, c) => sum + c.rate, 0) + receivers.reduce((sum, r) => sum + r.rate, 0)
    const rest = Math.max(0, rate + input.othersRate - taken)
    if (counts(rest)) lines.push({ key: 'product', kind: 'product', label: 'Block product', rate: rest, look: { kind: 'product' }, absorber: false, requested: false })
  }
  if (leftover > 0) lines.push({ key: 'left', kind: 'left', label: 'Left over', rate: leftover, look: { kind: 'left' }, absorber: false, requested: false })
  return { ...model, lines }
}

export type OutputEmptyState = 'unsolved' | 'discarded' | 'notProduced' | 'unused'

/** Why a model has no lines, or undefined when it has some. */
export function outputEmptyState(m: OutputModel): OutputEmptyState | undefined {
  if (!m.solved) return 'unsolved'
  if (m.discarded) return 'discarded'
  if (m.notProduced) return 'notProduced'
  if (m.lines.length === 0) return 'unused'
  return undefined
}

/** The short text of an empty state the panel shows (a discarded output shows none). */
export const OUTPUT_EMPTY_LABEL = { unsolved: 'Not solved yet.', notProduced: 'Not produced', unused: 'Not used' } as const

/** The tooltip of a line: its name and figure, then at most one plain sentence. `fmt` writes items/min with their unit. */
export function outputLineTip(line: OutputLine, fmt: (perMin: number) => string): string {
  switch (line.kind) {
    case 'row': {
      const head = `${line.label}${line.areaName !== undefined ? ` in ${line.areaName}` : ''} takes ${fmt(line.rate)}`
      return line.absorber ? `${head}\nabsorber: runs only on surplus` : head
    }
    case 'block': return `Sent to ${line.label}: ${fmt(line.rate)}${line.requested ? ' (requested)' : ''}`
    case 'product': return `A product of this block: ${fmt(line.rate)} left for its goal`
    case 'left': return `${fmt(line.rate)} left over in this block`
  }
}

/** The tooltip of the shared tag: the rates are the block's, and how many other rows make the item. */
export function sharedTagTip(m: OutputModel): string {
  const n = m.otherMakers
  return `These are the block's rates:\n${n} other ${n === 1 ? 'row also makes' : 'rows also make'} ${m.itemName}`
}

/** One short sentence for screen readers (not shown): what the lines say. */
export function outputReading(m: OutputModel, fmt: (perMin: number) => string): string {
  switch (outputEmptyState(m)) {
    case 'unsolved': return 'Not solved yet.'
    case 'discarded': return 'Discarded: not counted.'
    case 'notProduced': return 'Not produced at the moment.'
    case 'unused': return 'Not used by any row or block.'
  }
  const parts = m.lines.map(l => {
    switch (l.kind) {
      case 'row': return `${l.label}${l.absorber ? ' (absorber)' : ''} ${fmt(l.rate)}`
      case 'block': return `${l.label} ${fmt(l.rate)}`
      case 'product': return `block product ${fmt(l.rate)}`
      case 'left': return `left over ${fmt(l.rate)}`
    }
  })
  let text = `${parts.join(', ')}.`
  const n = m.otherMakers
  if (n > 0) text += ` These are the block's rates; ${n} other ${n === 1 ? 'row also makes' : 'rows also make'} it.`
  return text
}

// ---------------------------------------------------------------------------
// Gathering the outputs from the plan and the solve
// ---------------------------------------------------------------------------

/**
 * Whether what a row makes at `made` (the temperature of a split fluid; undefined for a plain item) is what `other` takes or
 * carries: a range accepts the temperatures it covers, a temperature only itself; an unknown temperature or a missing tag
 * matches anything, so a plain item always matches.
 */
export function tagReaches(made: FluidTag | undefined, other: FluidTag | undefined): boolean {
  if (made === undefined || other === undefined) return true
  if (isTemperatureTag(made)) {
    if (made.at === null) return true
    return isTemperatureTag(other) ? other.at === null || other.at === made.at : acceptsTemperature({ minimumTemperature: other.min, maximumTemperature: other.max }, made.at)
  }
  return flowKey('x', made) === flowKey('x', other)
}

/**
 * The other rows of the block that take `itemId` as an ingredient, with what the solver ran them at. The solve does not say
 * which row feeds which, so every row taking the item counts; for a split fluid only a row whose accepted range covers
 * `tag`, the temperature the row shown makes it at. `rowAreaId` is the area of the row the panel shows: a row of
 * another area carries the name of its area (only in a block with areas).
 */
export function itemConsumers(
  block: Block,
  gameData: GameData,
  result: SolverResult | undefined,
  itemId: string,
  tag: FluidTag | undefined,
  excludeNodeId: string,
  index: RecipeAreaIndex,
  rowAreaId: string | undefined,
): OutputConsumer[] {
  const consumers: OutputConsumer[] = []
  for (const n of result?.nodes ?? []) {
    const rate = n.inputRates[itemId] ?? 0
    if (n.recipeNodeId === excludeNodeId || !counts(rate) || !tagReaches(tag, n.inputTags?.[itemId])) continue
    const ref = index.rowById.get(n.recipeNodeId)
    if (!ref) continue
    consumers.push({
      nodeId: n.recipeNodeId,
      recipeName: gameData.recipes[ref.node.recipeId]?.name ?? ref.node.recipeId,
      rate,
      absorber: ref.node.byproductConsumer === true,
      ...(index.hasAreas && ref.areaId !== rowAreaId ? { areaName: areaName(block.rootPlan, ref.areaId) } : {}),
    })
  }
  return consumers
}

/**
 * The other rows of the block that make `itemId` and count it, and what they make: the rows of the solve other than
 * `selfNodeId` with an output above display noise, leaving out a row whose policy for the item is Discard (the solver gives it
 * no part in the item).
 */
export function otherMakers(result: SolverResult | undefined, index: RecipeAreaIndex, itemId: string, selfNodeId: string): { count: number; rate: number } {
  let count = 0
  let rate = 0
  for (const n of result?.nodes ?? []) {
    const made = n.outputRates[itemId] ?? 0
    if (n.recipeNodeId === selfNodeId || !counts(made)) continue
    if (index.rowById.get(n.recipeNodeId)?.node.byproductPolicy[itemId] === 'discard') continue
    count++
    rate += made
  }
  return { count, rate }
}

/**
 * The blocks that take `itemId` from the block over a connection, above the flow tolerance; a block named twice is summed.
 * For a split fluid only the parts that fit `tag` count.
 */
export function itemReceivers(
  blockId: string,
  blocks: readonly Block[],
  flows: readonly ConnectionFlow[],
  itemId: string,
  tag?: FluidTag,
): OutputReceiver[] {
  const byBlock = new Map<string, OutputReceiver>()
  for (const f of flows) {
    if (f.fromBlockId !== blockId || f.itemId !== itemId || !(f.rate > FLOW_TOLERANCE)) continue
    const rate = flowShares(f).filter(s => tagReaches(tag, parseFlowKey(s.key).tag)).reduce((sum, s) => sum + s.rate, 0)
    if (!(rate > FLOW_TOLERANCE)) continue
    const to = blocks.find(b => b.id === f.toBlockId)
    if (to === undefined) continue
    const requested = f.kind === 'request'
    const known = byBlock.get(f.toBlockId)
    if (known) {
      known.rate += rate
      known.requested ||= requested
    } else byBlock.set(f.toBlockId, { blockId: to.id, blockName: to.name, color: to.color ?? MISSING_BLOCK_COLOR, rate, requested })
  }
  return [...byBlock.values()]
}

/**
 * items/min of `itemId` the block has left over, from `leftoverByKey` (the Byproducts pane's maths): the leftover at the flow
 * key of the temperature the row makes the item at, or, with no `tag`, summed over the keys of the item. A product is never
 * left over, so the caller does not ask for one.
 */
export function itemLeftover(leftovers: ReadonlyMap<string, number>, itemId: string, tag?: FluidTag): number {
  if (tag !== undefined) return leftovers.get(flowKey(itemId, tag)) ?? 0
  let total = 0
  for (const [key, rate] of leftovers) if (parseFlowKey(key).itemId === itemId) total += rate
  return total
}
