import type { Block, ServedEntry, SubPlan } from '../data/types'
import { dropServedEntries, isServedConsumer, sameServedEntry, sameServedList, servedListOf, withServedEntryInserted, withServedList } from '../data/servedEntries'
import { blockAreas } from '../solver/areas'

/** What a cleanup removed from one source's list for one item, with the lists around it, so an undo can put it back. */
export interface ServedCut {
  sourceId: string
  itemId: string
  /** The list before the cut. */
  before: ServedEntry[]
  /** The list the cut wrote; undefined when the cut emptied it (the key is gone). */
  after: ServedEntry[] | undefined
  /** The entries removed, with their indexes in `before`. */
  cut: { entry: ServedEntry; index: number }[]
}

/**
 * `blocks` with the entries `drop` selects removed from every source's lists (the shape repaired, emptied lists
 * dropped), and what was cut. The same `blocks` and no cuts when nothing matches.
 */
export function cutServedEntries(
  blocks: Block[],
  drop: (source: Block, itemId: string, e: ServedEntry) => boolean,
): { blocks: Block[]; cuts: ServedCut[] } {
  const cuts: ServedCut[] = []
  const next = blocks.map(source => {
    let out = source
    for (const [itemId, list] of Object.entries(source.servedOrder ?? {})) {
      const cut = list.flatMap((entry, index) => (drop(source, itemId, entry) ? [{ entry, index }] : []))
      if (cut.length === 0) continue
      const after = dropServedEntries(list, (_e, i) => cut.some(c => c.index === i))
      out = withServedList(out, itemId, after)
      cuts.push({ sourceId: source.id, itemId, before: list, after: after.length === 0 ? undefined : after, cut })
    }
    return out
  })
  return cuts.length === 0 ? { blocks, cuts } : { blocks: next, cuts }
}

/**
 * `blocks` with `cuts` undone. A list still exactly as the cut left it is set back to what it was (flags and shares
 * included, an emptied key recreated). A list changed since gets the entries back one by one, bare, at their old
 * places (best effort); a list reset since is not brought back (a one-entry list would change the order served); a
 * source that is gone is skipped.
 */
export function restoreServedCuts(blocks: Block[], cuts: readonly ServedCut[]): Block[] {
  let out = blocks
  for (const cut of cuts) {
    const source = out.find(b => b.id === cut.sourceId)
    if (!source) continue
    const current = servedListOf(source, cut.itemId)
    let list: ServedEntry[] | undefined
    if (current === undefined ? cut.after === undefined : cut.after !== undefined && sameServedList(current, cut.after)) {
      list = cut.before
    } else if (current !== undefined) {
      list = current
      for (const { entry, index } of [...cut.cut].sort((a, b) => a.index - b.index)) {
        if (list.some(e => sameServedEntry(e, entry))) continue
        // The consumer may have lost its connection since the cut.
        if (entry.kind === 'block' && !isServedConsumer(out, cut.sourceId, cut.itemId, entry.blockId)) continue
        list = withServedEntryInserted(list, entry, index)
      }
    } else continue
    const next = withServedList(source, cut.itemId, list)
    out = out.map(b => (b === source ? next : b))
  }
  return out
}

/** The areas `before` has and `after` has not: sub-plans that stopped being areas or left the tree, and the root's id when the last area went. */
export function lostAreaIds(before: SubPlan, after: SubPlan): Set<string> {
  const kept = new Set((blockAreas(after) ?? []).map(a => a.id))
  return new Set((blockAreas(before) ?? []).map(a => a.id).filter(id => !kept.has(id)))
}
