import { closesLoop, hasProduct } from '../solver/blockGraph'
import { netBalance, receivesItem, FLOW_TOLERANCE } from '../solver/index'
import type { Block, ConnectionFlow, SolverResult } from '../data/types'

// ---------------------------------------------------------------------------
// Connection rules shared by the store, the Ingredients menu and the block graph
// ---------------------------------------------------------------------------

/**
 * Can `target` receive `itemId` from `fromBlockId`: source exists, not a product
 * of target, no duplicate (itemId, fromBlockId), not the target itself. Loops
 * through other blocks are allowed.
 */
export function canConnect(blocks: Block[], target: Block, itemId: string, fromBlockId: string): boolean {
  if (!blocks.some(b => b.id === fromBlockId)) return false
  if (fromBlockId === target.id) return false
  if (hasProduct(target, itemId)) return false
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

export interface TakeCandidate {
  block: Block
  offered: number
  /** Connecting would make the source and the target supply each other (directly or through other blocks). */
  closesLoop: boolean
}

/** Blocks that can supply their leftover `itemId` to `targetId`, in plan order; blocks with the item as a product are requested from instead. */
export function takeCandidates(
  blocks: Block[],
  targetId: string,
  itemId: string,
  results: Record<string, SolverResult>,
  flows: ConnectionFlow[],
): TakeCandidate[] {
  const target = blocks.find(b => b.id === targetId)
  if (!target) return []
  return blocks
    .filter(b => canConnect(blocks, target, itemId, b.id) && !hasProduct(b, itemId))
    .map(block => ({ block, offered: offeredRate(block.id, itemId, results, flows) }))
    .filter(({ offered }) => offered > FLOW_TOLERANCE)
    .map(({ block, offered }) => ({ block, offered, closesLoop: closesLoop(blocks, block.id, targetId) }))
}

/** Why a request for `itemId` from `fromBlockId` would not be applied (the source receives the item). */
export type RequestBlocker = 'source-receives'

/**
 * The one rule for "can `target` request `itemId` from `fromBlockId`", used by the
 * Request menu section, the connect-mode menu and the product-change effects. The store
 * accepts a request whose source receives the item (the solver ignores it as
 * `source-receives`). Undefined when the connection is not a request (the source has no
 * product for the item) or when the request can be applied. A request that closes a cycle
 * of requests can be applied: the solver solves the cycle in rounds.
 */
export function requestBlocker(
  blocks: Block[],
  itemId: string,
  fromBlockId: string,
): RequestBlocker | undefined {
  const source = blocks.find(b => b.id === fromBlockId)
  if (!source || !hasProduct(source, itemId)) return undefined
  return receivesItem(source, itemId, new Set(blocks.map(b => b.id))) ? 'source-receives' : undefined
}

/** Tooltip explaining a `RequestBlocker`. */
export function requestBlockerTitle(reason: RequestBlocker, sourceName: string, itemName: string): string {
  switch (reason) {
    case 'source-receives': return `${sourceName} receives ${itemName} itself`
  }
}

export interface RequestCandidate {
  block: Block
  /** Connecting would make the source and the target supply each other (directly or through other blocks). */
  closesLoop: boolean
  blocker?: RequestBlocker
}

/**
 * Blocks `targetId` can request `itemId` from, in plan order: connectable blocks
 * that have the item as a product, whatever they offer right now (the request is
 * what makes them produce).
 */
export function requestCandidates(blocks: Block[], targetId: string, itemId: string): RequestCandidate[] {
  const target = blocks.find(b => b.id === targetId)
  if (!target) return []
  return blocks
    .filter(b => canConnect(blocks, target, itemId, b.id) && hasProduct(b, itemId))
    .map(block => {
      const blocker = requestBlocker(blocks, itemId, block.id)
      return {
        block,
        closesLoop: closesLoop(blocks, block.id, targetId),
        ...(blocker ? { blocker } : {}),
      }
    })
}

export interface ItemCandidate {
  itemId: string
  offered: number
  needed: number
  /** The source has the item as a product, so connecting is a request. */
  request: boolean
  /** Why that request is not applied; only for requests. */
  blocker?: RequestBlocker
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
    if (offered <= FLOW_TOLERANCE) continue
    const source = blocks.find(b => b.id === sourceId)
    const request = !!source && hasProduct(source, u.itemId)
    const blocker = request ? requestBlocker(blocks, u.itemId, sourceId) : undefined
    items.push({ itemId: u.itemId, offered, needed: u.rate, request, ...(blocker ? { blocker } : {}) })
  }
  return items
}

export interface ProductChangeEffect {
  connectionId: string
  consumerId: string
  consumerName: string
  /** items/min currently delivered over the connection; undefined without a flow. */
  rate: number | undefined
  /** On 'add': why the request that would replace this take is not applied. */
  blocker?: RequestBlocker
}

/**
 * Connections of other blocks that change meaning when `blockId` gains (`add`) or
 * loses (`remove`) a product of `itemId`: takes that become requests, requests that
 * become takes. Empty when nothing changes (the block already has the product on add,
 * another product of the item remains on remove). Consumers in plan order.
 */
export function productChangeEffects(
  blocks: Block[],
  blockId: string,
  itemId: string,
  change: 'add' | 'remove',
  flows: ConnectionFlow[],
): ProductChangeEffect[] {
  const block = blocks.find(b => b.id === blockId)
  if (!block) return []
  if (change === 'add' && hasProduct(block, itemId)) return []
  if (change === 'remove' && block.products.filter(p => p.itemId === itemId).length !== 1) return []

  const ids = new Set(blocks.map(b => b.id))
  const effects: ProductChangeEffect[] = []
  for (const consumer of blocks) {
    if (consumer.id === blockId) continue
    const seen = new Set<string>()
    for (const c of consumer.inputConnections) {
      if (c.fromBlockId !== blockId || c.itemId !== itemId) continue
      const key = `${c.fromBlockId}\0${c.itemId}`
      if (seen.has(key)) continue
      seen.add(key)
      const flow = flows.find(f => f.connectionId === c.id)
      if (change === 'remove' && flow?.requestIgnored) continue
      const effect: ProductChangeEffect = {
        connectionId: c.id,
        consumerId: consumer.id,
        consumerName: consumer.name,
        rate: flow?.rate,
      }
      if (change === 'add' && receivesItem(block, itemId, ids)) effect.blocker = 'source-receives'
      effects.push(effect)
    }
  }
  return effects
}
