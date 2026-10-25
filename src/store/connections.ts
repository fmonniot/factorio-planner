import { closesLoop } from '../solver/blockGraph'
import { netBalance, FLOW_TOLERANCE } from '../solver/index'
import type { Block, ConnectionFlow, SolverResult } from '../data/types'

// ---------------------------------------------------------------------------
// Connection rules shared by the store, the Ingredients menu and the block graph
// ---------------------------------------------------------------------------

/** Goals never receive supply from other blocks. */
export function isGoalItem(block: Block, itemId: string): boolean {
  return block.goals.some(g => g.itemId === itemId)
}

/**
 * Can `target` receive `itemId` from `fromBlockId`: source exists, not a goal
 * of target, no duplicate (itemId, fromBlockId), not the target itself. Loops
 * through other blocks are allowed.
 */
export function canConnect(blocks: Block[], target: Block, itemId: string, fromBlockId: string): boolean {
  if (!blocks.some(b => b.id === fromBlockId)) return false
  if (fromBlockId === target.id) return false
  if (isGoalItem(target, itemId)) return false
  if (target.inputConnections.some(c => c.itemId === itemId && c.fromBlockId === fromBlockId)) return false
  return true
}

/** items/min of `itemId` the source still offers: its net balance minus what flows already deliver. */
export function offeredRate(
  sourceId: string,
  itemId: string,
  results: Record<string, SolverResult>,
  flows: ConnectionFlow[],
): number {
  // What is left after the deliveries to the source's other consumers.
  const taken = flows
    .filter(f => f.fromBlockId === sourceId && f.itemId === itemId)
    .reduce((sum, f) => sum + f.rate, 0)
  // Never negative: in a loop that did not settle, flows can add up to more than the source's last offer.
  return Math.max(0, (netBalance(results[sourceId]?.nodes ?? []).get(itemId) ?? 0) - taken)
}

export interface SourceCandidate {
  block: Block
  offered: number
  /** Connecting would make the source and the target supply each other (directly or through other blocks). */
  closesLoop: boolean
}

/** Blocks that can supply `itemId` to `targetId`, in plan order. */
export function sourceCandidates(
  blocks: Block[],
  targetId: string,
  itemId: string,
  results: Record<string, SolverResult>,
  flows: ConnectionFlow[],
): SourceCandidate[] {
  const target = blocks.find(b => b.id === targetId)
  if (!target) return []
  return blocks
    .filter(b => canConnect(blocks, target, itemId, b.id))
    .map(block => ({ block, offered: offeredRate(block.id, itemId, results, flows) }))
    .filter(({ offered }) => offered > FLOW_TOLERANCE)
    .map(({ block, offered }) => ({ block, offered, closesLoop: closesLoop(blocks, block.id, targetId) }))
}

export interface ItemCandidate {
  itemId: string
  offered: number
  needed: number
}

/**
 * Items `targetId` still imports (in its `unsatisfied` order) that `sourceId`
 * can send it. Empty when the target has no result yet.
 */
export function connectableItems(
  blocks: Block[],
  sourceId: string,
  targetId: string,
  results: Record<string, SolverResult>,
  flows: ConnectionFlow[],
): ItemCandidate[] {
  const target = blocks.find(b => b.id === targetId)
  const result = results[targetId]
  if (!target || !result) return []
  const items: ItemCandidate[] = []
  for (const u of result.unsatisfied) {
    if (u.rate <= FLOW_TOLERANCE) continue
    if (!canConnect(blocks, target, u.itemId, sourceId)) continue
    const offered = offeredRate(sourceId, u.itemId, results, flows)
    if (offered > FLOW_TOLERANCE) items.push({ itemId: u.itemId, offered, needed: u.rate })
  }
  return items
}
