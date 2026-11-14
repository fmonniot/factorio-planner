import type { Block, BlockConnection } from '../data/types'
import { FLOW_TOLERANCE } from './blockResult'

/** One entry of a served list that applies: the source's own extra output, or a consumer block with a connection for the item. */
export type RankedEntry = { kind: 'extra' } | { kind: 'block'; blockId: string; connection: BlockConnection }

/** A (source, item) pair whose stored served list the solver honours. */
export interface RankedPair {
  sourceId: string
  itemId: string
  /** Sum of the source's products' `extraRate` of the item (0 when none). */
  extraRate: number
  /** The entries that apply, in list order. */
  listed: RankedEntry[]
  /** Consumers the list does not name, in blocks order. */
  unlisted: { blockId: string; connection: BlockConnection }[]
}

/** source id → item id → pair. */
export type RankedPairs = Map<string, Map<string, RankedPair>>

/**
 * The (source, item) pairs whose served list the solver honours: the source has a list for the item,
 * neither the source nor any consumer of the item is a member of a loop of blocks (`loopMembers`), and
 * at least one entry applies. Entries that do not apply (repeats, the source itself, unknown blocks,
 * blocks with no connection for the item, the extra when the source has none) are dropped.
 * A consumer is counted under its first connection for the (source, item) pair.
 */
export function rankedPairs(blocks: readonly Block[], loopMembers: ReadonlySet<string>): RankedPairs {
  const pairs: RankedPairs = new Map()
  for (const source of blocks) {
    if (!source.servedOrder || loopMembers.has(source.id)) continue
    for (const [itemId, list] of Object.entries(source.servedOrder)) {
      const counting = new Map<string, { blockId: string; connection: BlockConnection }>() // blocks order
      for (const b of blocks) {
        if (b.id === source.id) continue
        const connection = b.inputConnections.find(c => c.fromBlockId === source.id && c.itemId === itemId)
        if (connection) counting.set(b.id, { blockId: b.id, connection })
      }
      if ([...counting.keys()].some(id => loopMembers.has(id))) continue
      let extraRate = 0
      for (const p of source.products) if (p.itemId === itemId) extraRate += p.extraRate ?? 0
      const listed: RankedEntry[] = []
      const seen = new Set<string>()
      for (const entry of list) {
        const key = entry.kind === 'extra' ? 'extra' : `block:${entry.blockId}`
        if (seen.has(key)) continue
        seen.add(key)
        if (entry.kind === 'extra') {
          if (extraRate > FLOW_TOLERANCE) listed.push({ kind: 'extra' })
          continue
        }
        const hit = counting.get(entry.blockId)
        if (hit) listed.push({ kind: 'block', blockId: hit.blockId, connection: hit.connection })
      }
      if (listed.length === 0) continue
      const unlisted = [...counting.values()].filter(c => !seen.has(`block:${c.blockId}`))
      let items = pairs.get(source.id)
      if (!items) pairs.set(source.id, (items = new Map()))
      items.set(itemId, { sourceId: source.id, itemId, extraRate, listed, unlisted })
    }
  }
  return pairs
}

/**
 * Hand an `offer` down `order`: each block entry is granted `min(its share, what is left)`, the extra
 * holds `min(extraRate, what is left)` without a grant entry. `held` is what the order holds in all (never above the offer).
 */
export function grantByRank(
  offer: number,
  order: readonly RankedEntry[],
  extraRate: number,
  shareOf: (connectionId: string) => number,
): { grants: Map<string, number>; held: number } {
  const total = Math.max(0, offer)
  let rest = total
  const grants = new Map<string, number>()
  for (const e of order) {
    const amount = Math.min(e.kind === 'extra' ? extraRate : Math.max(0, shareOf(e.connection.id)), rest)
    if (e.kind === 'block') grants.set(e.connection.id, amount)
    rest -= amount
  }
  return { grants, held: total - rest }
}

/** Where a served list puts each consumer and the extra, for the report. */
export interface ServedRank {
  /** Consumer blocks in rank order. */
  blockIds: string[]
  /** Consumers served before the extra (`blockIds.length` when the extra is not in the order). */
  extraPlace: number
}

export function servedRankOf(order: readonly RankedEntry[]): ServedRank {
  const blockIds: string[] = []
  let extraPlace: number | undefined
  for (const e of order) {
    if (e.kind === 'extra') extraPlace ??= blockIds.length
    else blockIds.push(e.blockId)
  }
  return { blockIds, extraPlace: extraPlace ?? blockIds.length }
}
