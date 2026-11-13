import type { Block, ServedEntry } from './types'

// Reads and edits of a block's `servedOrder` (itemId → the consumers and the extra output in the order they are
// served). All pure; each returns the same reference when nothing changes. Lowest layer: imports nothing but types.

/** Same place in a list: the same kind and, for a block entry, the same block. */
export function sameServedEntry(a: ServedEntry, b: ServedEntry): boolean {
  return a.kind === b.kind && (a.kind === 'extra' || (b.kind === 'block' && a.blockId === b.blockId))
}

/** The stored list of `itemId`, or undefined when the item has none. */
export function servedListOf(block: Block, itemId: string): ServedEntry[] | undefined {
  return block.servedOrder !== undefined && Object.hasOwn(block.servedOrder, itemId) ? block.servedOrder[itemId] : undefined
}

/** The two lists hold the same entries in the same order. */
export function sameServedList(a: readonly ServedEntry[], b: readonly ServedEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => sameServedEntry(e, b[i]))
}

const sameList = sameServedList

/**
 * The block with `itemId`'s list set, or removed when `list` is undefined or empty. The key is deleted, never
 * written as undefined; an emptied record removes `servedOrder`. The same block when the list would not change.
 */
export function withServedList(block: Block, itemId: string, list: readonly ServedEntry[] | undefined): Block {
  const current = servedListOf(block, itemId)
  if (list === undefined || list.length === 0) {
    if (current === undefined) return block
    const { servedOrder, ...rest } = block
    const order = Object.fromEntries(Object.entries(servedOrder ?? {}).filter(([id]) => id !== itemId))
    return Object.keys(order).length === 0 ? rest : { ...rest, servedOrder: order }
  }
  if (current !== undefined && sameList(current, list)) return block
  return { ...block, servedOrder: { ...block.servedOrder, [itemId]: [...list] } }
}

/**
 * `list` with `entry` placed just before `before`; at the end when `before` is null or no longer in the list. Undefined
 * when nothing would move.
 */
export function withServedEntryPlaced(list: readonly ServedEntry[], entry: ServedEntry, before: ServedEntry | null): ServedEntry[] | undefined {
  const rest = list.filter(e => !sameServedEntry(e, entry))
  const found = before === null ? -1 : rest.findIndex(e => sameServedEntry(e, before))
  const at = found < 0 ? rest.length : found
  const next = [...rest.slice(0, at), entry, ...rest.slice(at)]
  return sameList(next, list) ? undefined : next
}

/** The block has a connection for `itemId` from `sourceId`. */
export function takesFrom(block: Block, sourceId: string, itemId: string): boolean {
  return block.inputConnections.some(c => c.itemId === itemId && c.fromBlockId === sourceId)
}

/** `blockId` is a block other than the source that takes `itemId` from it. */
export function isServedConsumer(blocks: readonly Block[], sourceId: string, itemId: string, blockId: string): boolean {
  if (blockId === sourceId) return false
  const consumer = blocks.find(b => b.id === blockId)
  return consumer !== undefined && takesFrom(consumer, sourceId, itemId)
}

/** The block with every entry of `blockId` removed from its lists; emptied lists are dropped. */
export function withoutServedConsumer(block: Block, blockId: string): Block {
  if (block.servedOrder === undefined) return block
  let out = block
  for (const [itemId, list] of Object.entries(block.servedOrder)) {
    const kept = list.filter(e => !(e.kind === 'block' && e.blockId === blockId))
    if (kept.length !== list.length) out = withServedList(out, itemId, kept)
  }
  return out
}

/** `order` with block ids mapped through `ids`; entries with no mapping and emptied lists are dropped; undefined when nothing is left. */
export function remapServedOrder(order: Record<string, ServedEntry[]>, ids: ReadonlyMap<string, string>): Record<string, ServedEntry[]> | undefined {
  const out: Record<string, ServedEntry[]> = {}
  for (const [itemId, list] of Object.entries(order)) {
    const mapped = list.flatMap((e): ServedEntry[] => {
      if (e.kind === 'extra') return [e]
      const id = ids.get(e.blockId)
      return id === undefined ? [] : [{ kind: 'block', blockId: id }]
    })
    // defineProperty: a plain assignment of `__proto__` would set the prototype instead of an own key.
    if (mapped.length > 0) Object.defineProperty(out, itemId, { value: mapped, enumerable: true, writable: true, configurable: true })
  }
  return Object.keys(out).length > 0 ? out : undefined
}
