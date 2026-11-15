import type { Block, ServedEntry } from './types'

// Reads and edits of a block's `servedOrder` (itemId → the consumers and the extra output in the order they are
// served). All pure; the edits return the same reference when nothing changes. Lowest layer: imports nothing but types.
// schema.ts imports this file at runtime, so it must never import ./schema or ./types at runtime (a cycle); type-only imports are fine.

/** Same place in a list: the same kind and, for a block entry, the same block and the same area. `tied` and `share` do not count. */
export function sameServedEntry(a: ServedEntry, b: ServedEntry): boolean {
  if (a.kind === 'extra') return b.kind === 'extra'
  return b.kind === 'block' && a.blockId === b.blockId && a.areaId === b.areaId
}

/** The same place, the same `tied` and the same `share`. */
export function equalServedEntry(a: ServedEntry, b: ServedEntry): boolean {
  return sameServedEntry(a, b) && (a.tied === true) === (b.tied === true) && a.share === b.share
}

/** What an entry is called in a map or the DOM: `extra`, `block:<id>` or `block:<id>:area:<areaId>`. */
export function servedEntryKey(e: ServedEntry): string {
  if (e.kind === 'extra') return 'extra'
  return e.areaId === undefined ? `block:${e.blockId}` : `block:${e.blockId}:area:${e.areaId}`
}

/** The stored list of `itemId`, or undefined when the item has none. */
export function servedListOf(block: Block, itemId: string): ServedEntry[] | undefined {
  return block.servedOrder !== undefined && Object.hasOwn(block.servedOrder, itemId) ? block.servedOrder[itemId] : undefined
}

/** The two lists hold the same entries in the same order, with the same `tied` and `share` flags. */
export function sameServedList(a: readonly ServedEntry[], b: readonly ServedEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => equalServedEntry(e, b[i]))
}

const sameList = sameServedList

/** `e` with only the flags given; an absent flag is never written as undefined. */
function withFlags(e: ServedEntry, tied: boolean, share: number | undefined): ServedEntry {
  const flags = { ...(tied ? { tied: true as const } : {}), ...(share !== undefined ? { share } : {}) }
  if (e.kind === 'extra') return { kind: 'extra', ...flags }
  return { kind: 'block', blockId: e.blockId, ...(e.areaId !== undefined ? { areaId: e.areaId } : {}), ...flags }
}

const validShare = (share: number | undefined): share is number => share !== undefined && Number.isFinite(share) && share > 0

/** The groups of a list: a line plus the `tied` lines under it. The first line never counts as tied. */
export function servedGroups(list: readonly ServedEntry[]): ServedEntry[][] {
  const groups: ServedEntry[][] = []
  list.forEach((e, i) => {
    if (i === 0 || e.tied !== true) groups.push([e])
    else groups[groups.length - 1].push(e)
  })
  return groups
}

/** Index of the group each entry of `list` belongs to. */
function groupIndexes(list: readonly ServedEntry[]): number[] {
  let g = -1
  return list.map((e, i) => (i === 0 || e.tied !== true ? ++g : g))
}

/**
 * The percentages a group reads, in group order, summing to 100. No valid share (finite and positive): an even split.
 * Otherwise a member without one counts as the mean of the valid ones, then all are normalised.
 */
export function groupPercents(group: readonly ServedEntry[]): number[] {
  const valid = group.flatMap(e => (validShare(e.share) ? [e.share] : []))
  if (valid.length === 0) return group.map(() => 100 / group.length)
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length
  const weights = group.map(e => (validShare(e.share) ? e.share : mean))
  const total = weights.reduce((a, b) => a + b, 0)
  return weights.map(w => (w * 100) / total)
}

// ── Shape repair and canonical form ─────────────────────────────────────────

/**
 * `after` (an edit of `before`) made well-formed: the first line is not tied, an invalid share goes, and a share
 * survives only on an entry whose group has two members or more and still shares two members or more (itself included)
 * with its group in `before`. A leaver loses its share, a joiner has none.
 */
export function repairServedShape(before: readonly ServedEntry[], after: readonly ServedEntry[]): ServedEntry[] {
  const beforeGroup = groupIndexes(before)
  const afterGroup = groupIndexes(after.map((e, i) => (i === 0 && e.tied === true ? withFlags(e, false, e.share) : e)))
  const origin = after.map(e => before.findIndex(o => sameServedEntry(o, e)))
  return after.map((e, i) => {
    const tied = i > 0 && e.tied === true
    let share = validShare(e.share) ? e.share : undefined
    if (share !== undefined) {
      const sameGroup = afterGroup.filter(g => g === afterGroup[i]).length
      const kept = origin[i] < 0 ? 0 : after.filter((_, j) => afterGroup[j] === afterGroup[i] && origin[j] >= 0 && beforeGroup[origin[j]] === beforeGroup[origin[i]]).length
      if (sameGroup < 2 || kept < 2) share = undefined
    }
    return withFlags(e, tied, share)
  })
}

/**
 * `list` without the entries `drop` selects: when a group's head leaves, its first remaining member becomes head (a
 * removal never merges two groups), and the shape is repaired. The only way to remove entries.
 */
export function dropServedEntries(list: readonly ServedEntry[], drop: (e: ServedEntry, index: number) => boolean): ServedEntry[] {
  const out: ServedEntry[] = []
  let keptInGroup = false
  list.forEach((e, i) => {
    const head = i === 0 || e.tied !== true
    if (head) keptInGroup = false
    if (drop(e, i)) return
    out.push(head || keptInGroup ? e : withFlags(e, false, e.share))
    keptInGroup = true
  })
  return repairServedShape(list, out)
}

function canonicalOf(list: readonly ServedEntry[]): ServedEntry[] {
  const seen: ServedEntry[] = []
  const unique = dropServedEntries(list, e => {
    if (seen.some(o => sameServedEntry(o, e))) return true
    seen.push(e)
    return false
  })
  return repairServedShape(unique, unique)
}

/** `list` in canonical form (no repeats, no tied first line, no invalid or lone share); the same array when it already is. */
export function canonicalServedList(list: ServedEntry[]): ServedEntry[] {
  const out = canonicalOf(list)
  return sameServedList(out, list) ? list : out
}

export function isCanonicalServedList(list: readonly ServedEntry[]): boolean {
  return sameServedList(canonicalOf(list), list)
}

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
 * `list` with a bare `entry` inserted at `index`. It is tied when it lands inside a group (before a tied line), a solo
 * line otherwise.
 */
export function withServedEntryInserted(list: readonly ServedEntry[], entry: ServedEntry, index: number): ServedEntry[] {
  const at = Math.max(0, Math.min(Math.trunc(index), list.length))
  const inside = at > 0 && at < list.length && list[at].tied === true
  const next = [...list.slice(0, at), withFlags(entry, inside, undefined), ...list.slice(at)]
  return repairServedShape(list, next)
}

/**
 * `list` with `entry` placed just before `before`; at the end when `before` is null or no longer in the list. An entry
 * in the list keeps its stored share and the shape stays by position (a move is a swap: the tied flags stay at their
 * indexes); an entry that is not joins bare. Undefined when nothing would change.
 */
export function withServedEntryPlaced(list: readonly ServedEntry[], entry: ServedEntry, before: ServedEntry | null): ServedEntry[] | undefined {
  const from = list.findIndex(e => sameServedEntry(e, entry))
  if (from < 0) {
    const anchor = before === null ? -1 : list.findIndex(e => sameServedEntry(e, before))
    return withServedEntryInserted(list, entry, anchor < 0 ? list.length : anchor)
  }
  const rest = list.filter((_, i) => i !== from)
  const found = before === null ? -1 : rest.findIndex(e => sameServedEntry(e, before))
  const at = found < 0 ? rest.length : found
  const moved = [...rest.slice(0, at), list[from], ...rest.slice(at)]
  const placed = moved.map((e, i) => withFlags(e, i > 0 && list[i].tied === true, e.share))
  const next = repairServedShape(list, placed)
  return sameList(next, list) ? undefined : next
}

/**
 * `list` with `entry` tied to the line above it, or not. Tying a head merges its whole group into the one above; untying
 * a middle member splits there. Undefined when the entry is absent, is the first line, or is already in that state.
 */
export function withServedTied(list: readonly ServedEntry[], entry: ServedEntry, tied: boolean): ServedEntry[] | undefined {
  const at = list.findIndex(e => sameServedEntry(e, entry))
  if (at < 0 || (tied && at === 0) || (list[at].tied === true) === tied) return undefined
  return repairServedShape(list, list.map((e, i) => (i === at ? withFlags(e, tied, e.share) : e)))
}

/**
 * `list` with `entry` reading `percent` of its group; the others scale to fill the rest, and every member of the group
 * stores a share. Undefined when the entry is absent or alone in its group, `percent` is not in (0, 100), or the group
 * would read what it reads already.
 */
export function withServedShare(list: readonly ServedEntry[], entry: ServedEntry, percent: number): ServedEntry[] | undefined {
  const at = list.findIndex(e => sameServedEntry(e, entry))
  if (at < 0 || !(Number.isFinite(percent) && percent > 0 && percent < 100)) return undefined
  const indexes = groupIndexes(list)
  const members = list.flatMap((_, i) => (indexes[i] === indexes[at] ? [i] : []))
  if (members.length < 2) return undefined
  const cur = groupPercents(members.map(i => list[i]))
  const k = members.indexOf(at)
  if (100 - cur[k] <= 1e-12) return undefined
  const read = cur.map((c, m) => (m === k ? percent : (c * (100 - percent)) / (100 - cur[k])))
  if (read.every((r, m) => Math.abs(r - cur[m]) < 1e-9)) return undefined
  const next = [...list]
  members.forEach((i, m) => {
    next[i] = withFlags(list[i], i > 0 && list[i].tied === true, Math.max(1e-6, Math.round(read[m] * 1e6) / 1e6))
  })
  return next
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

/** The block with the entries `drop` selects removed from its lists (the shape repaired, emptied lists dropped); the same block when none matches. */
function withoutServedWhere(block: Block, drop: (e: ServedEntry) => boolean): Block {
  if (block.servedOrder === undefined) return block
  let out = block
  for (const [itemId, list] of Object.entries(block.servedOrder)) {
    if (list.some(drop)) out = withServedList(out, itemId, dropServedEntries(list, drop))
  }
  return out
}

/** The block with every entry of `blockId` (plain and area) removed from its lists; emptied lists are dropped. */
export function withoutServedConsumer(block: Block, blockId: string): Block {
  return withoutServedWhere(block, e => e.kind === 'block' && e.blockId === blockId)
}

/**
 * `order` with block ids mapped through `ids` and area ids through `areaIds` (`tied` and `share` stay); entries whose
 * block, or whose area when it names one, has no mapping are dropped, and so are emptied lists. Undefined when nothing is left.
 */
export function remapServedOrder(
  order: Record<string, ServedEntry[]>,
  ids: ReadonlyMap<string, string>,
  areaIds: ReadonlyMap<string, string>,
): Record<string, ServedEntry[]> | undefined {
  const out: Record<string, ServedEntry[]> = {}
  for (const [itemId, list] of Object.entries(order)) {
    const dropped = list.map(e => e.kind === 'block' && (!ids.has(e.blockId) || (e.areaId !== undefined && !areaIds.has(e.areaId))))
    const renamed = list.map((e): ServedEntry => {
      if (e.kind === 'extra') return e
      const blockId = ids.get(e.blockId) ?? e.blockId
      return e.areaId === undefined ? { ...e, blockId } : { ...e, blockId, areaId: areaIds.get(e.areaId) ?? e.areaId }
    })
    const mapped = dropServedEntries(renamed, (_e, i) => dropped[i])
    // defineProperty: a plain assignment of `__proto__` would set the prototype instead of an own key.
    if (mapped.length > 0) Object.defineProperty(out, itemId, { value: mapped, enumerable: true, writable: true, configurable: true })
  }
  return Object.keys(out).length > 0 ? out : undefined
}
