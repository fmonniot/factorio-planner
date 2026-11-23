import type { Block, GameData, SolverResult, ConnectionFlow } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { parseFlowKey } from '../../data/flowKey'
import { areaName } from '../../data/subPlanTree'
import { FLOW_TOLERANCE, netBalance, grossFlow } from '../../solver/index'
import { fmtItemRateText } from './ItemTile'
import { flowShares } from './flowParts'
import type { RecipeAreaIndex } from './recipeAreas'
import { isLeftover } from './summaryRows'

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
  /** Other rows of the block that make the item at the moment. */
  otherMakers: number
}

const EPS = 1e-6

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
  if (rate <= EPS) return `Not produced: this row makes no ${itemName} at the moment.`

  const clauses: string[] = []
  if (product) clauses.push('A product of this block')
  if (consumers.length > 0) {
    const used = consumers.map(c => `${c.recipeName}${c.areaName !== undefined ? ` in ${c.areaName}` : ''} (${c.absorber ? 'absorber, ' : ''}takes ${fmt(c.rate)})`)
    clauses.push(`Used here by ${list(used)}`)
  }
  if (receivers.length > 0) clauses.push(`Sent to ${list(receivers.map(r => `${r.blockName} (${fmt(r.rate)})`))}`)
  if (leftover > 0) clauses.push(`${fmt(leftover)} left over`)

  let text = 'Not used by any row or block.'
  if (clauses.length > 0) text = `${clauses.join('; ')}.`
  // Only a leftover to speak of: nothing in the block or beyond takes the item.
  if (consumers.length === 0 && receivers.length === 0 && !product && leftover > 0) {
    text = `Left over: no row or block uses it (${fmt(leftover)}).`
  }
  if (otherMakers > 0) text += ` Also made by ${otherMakers} other ${otherMakers === 1 ? 'row' : 'rows'}.`
  return text
}

// ---------------------------------------------------------------------------
// Gathering the outputs from the plan and the solve
// ---------------------------------------------------------------------------

/**
 * The other rows of the block that take `itemId` as an ingredient, with what the solver ran them at. The solve does not say
 * which row feeds which, so every row taking the item counts. `rowAreaId` is the area of the row the panel shows: a row of
 * another area carries the name of its area (only in a block with areas).
 */
export function itemConsumers(
  block: Block,
  gameData: GameData,
  result: SolverResult | undefined,
  itemId: string,
  excludeNodeId: string,
  index: RecipeAreaIndex,
  rowAreaId: string | undefined,
): OutputConsumer[] {
  const consumers: OutputConsumer[] = []
  for (const n of result?.nodes ?? []) {
    const rate = n.inputRates[itemId] ?? 0
    if (n.recipeNodeId === excludeNodeId || !(rate > EPS)) continue
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

/** The blocks that take `itemId` from the block over a connection, above the flow tolerance; a block named twice is summed. */
export function itemReceivers(
  blockId: string,
  blocks: readonly Block[],
  flows: readonly ConnectionFlow[],
  itemId: string,
): OutputReceiver[] {
  const byBlock = new Map<string, OutputReceiver>()
  for (const f of flows) {
    if (f.fromBlockId !== blockId || f.itemId !== itemId || !(f.rate > FLOW_TOLERANCE)) continue
    const name = blocks.find(b => b.id === f.toBlockId)?.name
    if (name === undefined) continue
    const known = byBlock.get(f.toBlockId)
    if (known) known.rate += f.rate
    else byBlock.set(f.toBlockId, { blockName: name, rate: f.rate })
  }
  return [...byBlock.values()]
}

/**
 * items/min of `itemId` the block has left over: its net surplus minus what other blocks take, summed over the flow keys of
 * the item. The same maths as the Byproducts pane of `FactorySummary.tsx` (keep the two in step); a product is never
 * left over, so the caller does not ask for one.
 */
export function itemLeftover(result: SolverResult | undefined, flows: readonly ConnectionFlow[], blockId: string, itemId: string): number {
  if (!result) return 0
  const net = netBalance(result.nodes, result.conversions)
  const gross = grossFlow(result.nodes, result.conversions)
  const exportedByKey = new Map<string, number>()
  for (const f of flows) {
    if (f.fromBlockId !== blockId || !(f.rate > FLOW_TOLERANCE)) continue
    for (const share of flowShares(f)) {
      if (share.rate > FLOW_TOLERANCE) exportedByKey.set(share.key, (exportedByKey.get(share.key) ?? 0) + share.rate)
    }
  }
  let total = 0
  for (const [key, balance] of net) {
    if (parseFlowKey(key).itemId !== itemId) continue
    const taken = Math.min(Math.max(0, balance), exportedByKey.get(key) ?? 0)
    const left = balance - taken
    if (isLeftover(left, gross.get(key) ?? 0)) total += left
  }
  return total
}
