import type { Block, ConnectionFlow, ServedConsumer, ServedExtra, ServedList } from '../data/types'
import { FLOW_TOLERANCE } from './blockResult'
import type { ServedRank } from './servedRank'

/**
 * The order each source served its consumers in: `flows` is in commit order (solve order; in a loop,
 * member order of the final round), so the counting flows of one (source, item) are already in served
 * order. One entry per consumer block: a second connection of the same block for the pair delivers 0
 * and is skipped. `self` and `missing-source` flows are not served. `shareOf` gives the amount reserved
 * for a connection while others were served; `left` is what the sources have left after the solve.
 * The source's own extra output of the item (the sum of its products' `extraRate`) is served last.
 * A pair the solver served by the source's stored list (`rankOf` gives its rank) is reported in that
 * order, the consumers the list does not name after the named ones in flow order, and the extra at the
 * place the list gives it.
 */
export function buildServed(
  flows: ConnectionFlow[],
  blocks: Block[],
  shareOf: (connectionId: string) => number,
  left: ReadonlyMap<string, ReadonlyMap<string, number>>,
  rankOf?: (sourceId: string, itemId: string) => ServedRank | undefined,
): Record<string, Record<string, ServedList>> {
  const bySource = new Map<string, Map<string, ServedConsumer[]>>()
  for (const f of flows) {
    if (f.status === 'self' || f.status === 'missing-source') continue
    let items = bySource.get(f.fromBlockId)
    if (!items) bySource.set(f.fromBlockId, (items = new Map()))
    let consumers = items.get(f.itemId)
    if (!consumers) items.set(f.itemId, (consumers = []))
    if (consumers.some(c => c.blockId === f.toBlockId)) continue
    consumers.push({ blockId: f.toBlockId, connectionId: f.connectionId, kind: f.kind, share: shareOf(f.connectionId), got: f.rate })
  }
  const blockById = new Map(blocks.map(b => [b.id, b]))
  return Object.fromEntries([...bySource].map(([sourceId, items]) => [
    sourceId,
    Object.fromEntries([...items].map(([itemId, flowOrder]): [string, ServedList] => {
      const rank = rankOf?.(sourceId, itemId)
      let consumers = flowOrder
      if (rank) {
        const at = (c: ServedConsumer): number => {
          const i = rank.blockIds.indexOf(c.blockId)
          return i < 0 ? rank.blockIds.length : i
        }
        consumers = [...flowOrder].sort((a, b) => at(a) - at(b)) // stable
      }
      let asked = 0
      for (const p of blockById.get(sourceId)?.products ?? []) if (p.itemId === itemId) asked += p.extraRate ?? 0
      if (!(asked > FLOW_TOLERANCE)) return [itemId, { consumers }]
      const extra: ServedExtra = {
        place: rank ? Math.min(rank.extraPlace, consumers.length) : consumers.length,
        asked,
        got: Math.min(asked, left.get(sourceId)?.get(itemId) ?? 0),
      }
      return [itemId, { consumers, extra }]
    })),
  ]))
}
