import type { Block, FluidTag, GameData, SolverResult, ConnectionFlow } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { flowKey, isTemperatureTag, parseFlowKey } from '../../data/flowKey'
import { acceptsTemperature } from '../../data/temperature'
import { areaName } from '../../data/subPlanTree'
import { FLOW_TOLERANCE } from '../../solver/index'
import { fmtItemRateText } from './ItemTile'
import { flowShares } from './flowParts'
import type { RecipeAreaIndex } from './recipeAreas'
import { showsAsPositive } from './summaryRows'

// ---------------------------------------------------------------------------
// The sentence under each output of the side panel: where one product or byproduct of a row goes, from what the solver
// did. A pure function of plain data (like `sourcingText.ts`); no generated text. Rates are items/min and go through
// `fmtItemRateText`.
// ---------------------------------------------------------------------------

/** A row of the block that takes the item as an ingredient. */
export interface OutputConsumer {
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
  blockName: string
  /** items/min delivered. */
  rate: number
}

export interface OutputTextInput {
  itemId: string
  itemName: string
  unit: RateUnit
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
}

/** A rate worth speaking of: one that shows as more than 0.00/min, so no sentence reads "takes 0.0/m". */
function counts(perMin: number): boolean {
  return showsAsPositive(perMin)
}

function list(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** Where the item goes: the rows that use it, the blocks it is sent to and what is left over. */
export function outputText(input: OutputTextInput): string {
  const { itemId, itemName, unit, solved, rate, discarded, product, consumers, receivers, leftover, otherMakers } = input
  const fmt = (perMin: number) => fmtItemRateText(itemId, perMin / 60, unit)

  if (!solved) return 'Not solved yet.'
  if (discarded) return `Discarded: this row's ${itemName} is not counted, so no row or block takes it from here.`
  if (!counts(rate)) return `Not produced: this row makes no ${itemName} at the moment.`

  // With other makers the rates are the block's, not this row's: the clauses say so.
  const shared = otherMakers > 0
  const clauses: string[] = []
  if (product) clauses.push('A product of this block')
  if (consumers.length > 0) {
    const used = consumers.map(c => `${c.recipeName}${c.areaName !== undefined ? ` in ${c.areaName}` : ''} (${c.absorber ? 'absorber, ' : ''}takes ${fmt(c.rate)})`)
    clauses.push(`${shared ? 'Used in this block by' : 'Used here by'} ${list(used)}`)
  }
  if (receivers.length > 0) clauses.push(`${shared ? 'Sent from this block to' : 'Sent to'} ${list(receivers.map(r => `${r.blockName} (${fmt(r.rate)})`))}`)
  if (leftover > 0) clauses.push(`${fmt(leftover)} left over${shared ? ' in this block' : ''}`)

  let text = 'Not used by any row or block.'
  if (clauses.length > 0) text = `${clauses.join('; ')}.`
  // Only a leftover to speak of: nothing in the block or beyond takes the item.
  if (consumers.length === 0 && receivers.length === 0 && !product && leftover > 0) {
    text = `Left over: no row or block uses it (${fmt(leftover)}).`
  }
  if (shared) text += ` These are the block's rates: ${otherMakers} other ${otherMakers === 1 ? 'row' : 'rows'} also make${otherMakers === 1 ? 's' : ''} it.`
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
      recipeName: gameData.recipes[ref.node.recipeId]?.name ?? ref.node.recipeId,
      rate,
      absorber: ref.node.byproductConsumer === true,
      ...(index.hasAreas && ref.areaId !== rowAreaId ? { areaName: areaName(block.rootPlan, ref.areaId) } : {}),
    })
  }
  return consumers
}

/**
 * How many other rows make `itemId` and count it: the rows of the solve other than `selfNodeId` with an output above
 * display noise, leaving out a row whose policy for the item is Discard (the solver gives it no part in the item).
 */
export function countOtherMakers(result: SolverResult | undefined, index: RecipeAreaIndex, itemId: string, selfNodeId: string): number {
  let count = 0
  for (const n of result?.nodes ?? []) {
    if (n.recipeNodeId === selfNodeId || !counts(n.outputRates[itemId] ?? 0)) continue
    if (index.rowById.get(n.recipeNodeId)?.node.byproductPolicy[itemId] === 'discard') continue
    count++
  }
  return count
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
    const name = blocks.find(b => b.id === f.toBlockId)?.name
    if (name === undefined) continue
    const known = byBlock.get(f.toBlockId)
    if (known) known.rate += rate
    else byBlock.set(f.toBlockId, { blockName: name, rate })
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
