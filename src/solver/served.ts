import type { Block, ConnectionFlow, ServedConsumer, ServedExtra, ServedList } from '../data/types'
import { flowKey, sumOfItem } from '../data/flowKey'
import { FLOW_TOLERANCE } from './blockResult'
import { areaLines, type AreaReport } from './servedAreas'
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
 * place the list gives it. Members of a group keep the list's order; `share` is what was asked, not the group's grant.
 * A consumer block shown as areas (see `areaLines`) has one line per entry, with its `areaId`; `areaReport` gives it the areas' needs and the entries of a ranked pair.
 */
export function buildServed(
  flows: ConnectionFlow[],
  blocks: Block[],
  shareOf: (connectionId: string) => number,
  left: ReadonlyMap<string, ReadonlyMap<string, number>>,
  rankOf?: (sourceId: string, itemId: string) => ServedRank | undefined,
  takeInfo?: { needs: ReadonlyMap<string, number>; uncredited: ReadonlySet<string>; inListOrder?: ReadonlySet<string> },
  areaReport?: AreaReport,
  /** A split fluid: what a connection is reserved per flow key (its request's parts or its take's credit); gives a block line its `parts`. */
  keySharesOf?: (connectionId: string) => ReadonlyMap<string, number> | undefined,
): Record<string, Record<string, ServedList>> {
  const bySource = new Map<string, Map<string, ServedConsumer[]>>()
  for (const f of flows) {
    if (f.status === 'self' || f.status === 'missing-source') continue
    let items = bySource.get(f.fromBlockId)
    if (!items) bySource.set(f.fromBlockId, (items = new Map()))
    let consumers = items.get(f.itemId)
    if (!consumers) items.set(f.itemId, (consumers = []))
    if (consumers.some(c => c.blockId === f.toBlockId)) continue
    const consumer: ServedConsumer = { blockId: f.toBlockId, connectionId: f.connectionId, kind: f.kind, share: shareOf(f.connectionId), got: f.rate }
    if (f.parts) {
      const shares = keySharesOf?.(f.connectionId)
      consumer.parts = f.parts.map(p => ({ temp: p.temp, share: shares?.get(flowKey(f.itemId, p.temp)) ?? 0, got: p.rate }))
    }
    if (takeInfo && f.kind === 'take') {
      const need = takeInfo.needs.get(f.connectionId)
      if (need !== undefined) consumer.need = need
      if (takeInfo.uncredited.has(f.connectionId)) consumer.notCredited = true
      if (takeInfo.inListOrder?.has(f.connectionId)) consumer.groupInListOrder = true
    }
    consumers.push(consumer)
  }
  const blockById = new Map(blocks.map(b => [b.id, b]))
  return Object.fromEntries([...bySource].map(([sourceId, items]) => [
    sourceId,
    Object.fromEntries([...items].map(([itemId, flowOrder]): [string, ServedList] => {
      const rank = rankOf?.(sourceId, itemId)
      let consumers = flowOrder
      let place: number | undefined
      const split = areaReport && areaLines(sourceId, itemId, flowOrder, areaReport.entriesOf(sourceId, itemId), b => areaReport.needsOf(b, itemId))
      if (split) {
        consumers = split.consumers
        place = split.extraPlace
      } else if (rank) {
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
        place: place ?? (rank ? Math.min(rank.extraPlace, consumers.length) : consumers.length),
        asked,
        got: Math.min(asked, sumOfItem(left.get(sourceId), itemId)),
      }
      return [itemId, { consumers, extra }]
    })),
  ]))
}
