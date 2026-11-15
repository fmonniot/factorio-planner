import type { Block, BlockConnection } from '../data/types'
import { dropServedEntries, groupPercents, servedEntryKey, servedGroups, servedGroupSpans, validShare } from '../data/servedEntries'
import { blockAreas } from './areas'
import { FLOW_TOLERANCE } from './blockResult'
import type { AreaNeed } from './servedAreas'

/** Group flags of a listed entry; absent on a list without `tied`. */
interface RankedFlags {
  /** Shares the rank of the entry above it; set only on members after a group's head. */
  tied?: true
  /** The member's weight in its group, a percentage summing to 100 over the group. Set on every member of a group of two or more only when some member stores a `share`; absent means equal weights. */
  weight?: number
}

/** One entry of a served list that applies: the source's own extra output, or a consumer block with a connection for the item. */
export type RankedEntry = (
  | { kind: 'extra' }
  | {
      kind: 'block'
      blockId: string
      connection: BlockConnection
      /** The area of the consumer this entry names; absent: the block entry, standing for the areas no area entry names. */
      areaId?: string
      /** Set by `splitByArea`: the areas this entry covers (table order), the block's total need and this entry's part of it. */
      areas?: readonly AreaNeed[]
      total?: number
      part?: number
    }
) & RankedFlags

/** A (source, item) pair whose stored served list the solver honours. */
export interface RankedPair {
  sourceId: string
  itemId: string
  /** Sum of the source's products' `extraRate` of the item (0 when none). */
  extraRate: number
  /** The entries that apply, in list order. */
  listed: RankedEntry[]
  /** Consumers the list does not name, in blocks order. */
  unlisted: {
    blockId: string
    connection: BlockConnection
    /** The consumer is named by an area entry of `listed`; its block entry sits here, among the consumers the list does not name. */
    areaNamed?: true
  }[]
}

/** source id → item id → pair. */
export type RankedPairs = Map<string, Map<string, RankedPair>>

/**
 * The (source, item) pairs whose served list the solver honours: the source has a list for the item and
 * at least one entry applies, whatever loops (of blocks or of requests) the blocks are in. Entries that do not apply (repeats, the source itself, unknown blocks,
 * blocks with no connection for the item, the extra when the source has none, entries naming an area the consumer does not have) are removed with `dropServedEntries`, so the
 * `tied` groups are formed among the entries that apply (a removed entry never merges or splits groups) and a group's `share`s become `weight`s.
 * A consumer is counted under its first connection for the (source, item) pair. An entry naming an area applies when its
 * consumer counts and the area is one of its areas (the root's id included, once the block has areas); entries of one block
 * (its block entry and its area entries) are distinct, a repeat of one is dropped. A consumer named only by area entries
 * stays in `unlisted` too, flagged `areaNamed`: its block entry stands for the areas no entry names.
 */
export function rankedPairs(blocks: readonly Block[]): RankedPairs {
  const pairs: RankedPairs = new Map()
  const blockById = new Map(blocks.map(b => [b.id, b]))
  for (const source of blocks) {
    if (!source.servedOrder) continue
    for (const [itemId, list] of Object.entries(source.servedOrder)) {
      const counting = new Map<string, { blockId: string; connection: BlockConnection }>() // blocks order
      for (const b of blocks) {
        if (b.id === source.id) continue
        const connection = b.inputConnections.find(c => c.fromBlockId === source.id && c.itemId === itemId)
        if (connection) counting.set(b.id, { blockId: b.id, connection })
      }
      let extraRate = 0
      for (const p of source.products) if (p.itemId === itemId) extraRate += p.extraRate ?? 0
      const seen = new Set<string>()
      const areasOf = new Map<string, Set<string> | undefined>() // consumer id → its area ids, looked up once
      const hasArea = (blockId: string, areaId: string): boolean => {
        if (!areasOf.has(blockId)) {
          const areas = blockById.get(blockId) ? blockAreas(blockById.get(blockId)!.rootPlan) : undefined
          areasOf.set(blockId, areas && new Set(areas.map(a => a.id)))
        }
        return areasOf.get(blockId)?.has(areaId) ?? false
      }
      const areaNamedIds = new Set<string>()
      const hit: Array<RankedEntry | undefined> = [] // by list index: the entry when it applies
      for (const entry of list) {
        const key = servedEntryKey(entry)
        if (seen.has(key)) { hit.push(undefined); continue }
        seen.add(key)
        if (entry.kind === 'extra') {
          hit.push(extraRate > FLOW_TOLERANCE ? { kind: 'extra' } : undefined)
          continue
        }
        const found = counting.get(entry.blockId)
        if (found && entry.areaId !== undefined && !hasArea(entry.blockId, entry.areaId)) {
          hit.push(undefined)
          continue
        }
        if (found && entry.areaId !== undefined) areaNamedIds.add(entry.blockId)
        hit.push(found ? { kind: 'block', blockId: found.blockId, connection: found.connection, ...(entry.areaId !== undefined ? { areaId: entry.areaId } : {}) } : undefined)
      }
      const kept = dropServedEntries(list, (_e, i) => hit[i] === undefined)
      const survivors = hit.flatMap(h => (h ? [h] : [])) // parallel to `kept`
      const listed: RankedEntry[] = []
      let k = 0
      for (const group of servedGroups(kept)) {
        const weights = group.length > 1 && group.some(e => e.share !== undefined) ? groupPercents(group) : undefined
        group.forEach((_e, m) => {
          listed.push({ ...survivors[k++], ...(m > 0 ? { tied: true as const } : {}), ...(weights ? { weight: weights[m] } : {}) })
        })
      }
      if (listed.length === 0) continue
      const unlisted = [...counting.values()]
        .filter(c => !seen.has(`block:${c.blockId}`))
        .map(c => (areaNamedIds.has(c.blockId) ? { ...c, areaNamed: true as const } : c))
      let items = pairs.get(source.id)
      if (!items) pairs.set(source.id, (items = new Map()))
      items.set(itemId, { sourceId: source.id, itemId, extraRate, listed, unlisted })
    }
  }
  return pairs
}

/**
 * Hand an `offer` down `order`. A group is an entry plus the entries after it marked `tied`. Groups are served in order,
 * each from what the groups above left. A group of one gets `min(its share, what is left)`; inside a group of two or more
 * each member still short is offered `left * weight / sum of the weights` and takes `min(what it lacks, that)`, again and
 * again while something is left and somebody is short. The extra is a member like any block (its share is `extraRate`)
 * but has no grant entry. A group with a member for which `inListOrder` holds is served in list order, member by member (a group
 * of takes the request pass could not share by need; see `computeRequests`). `held` is what the
 * order holds in all (never above the offer). An entry of a split consumer (see `splitByArea`) asks its connection's share times
 * its `part`; a connection's grant is the sum over its entries, and `entryGrants` lists each entry's own grant, parallel to `order`.
 */
export function grantByRank(
  offer: number,
  order: readonly RankedEntry[],
  extraRate: number,
  shareOf: (connectionId: string) => number,
  inListOrder?: (connectionId: string) => boolean,
): { grants: Map<string, number>; held: number; entryGrants: number[] } {
  const total = Math.max(0, offer)
  let rest = total
  const grants = new Map<string, number>()
  const entryGrants = order.map(() => 0)
  const askOf = (e: RankedEntry): number => {
    if (e.kind === 'extra') return extraRate
    const share = Math.max(0, shareOf(e.connection.id))
    return e.part === undefined ? share : share * e.part
  }
  const give = (e: RankedEntry, at: number, amount: number): void => {
    entryGrants[at] = amount
    if (e.kind === 'block') grants.set(e.connection.id, (grants.get(e.connection.id) ?? 0) + amount)
  }
  for (const [start, end] of servedGroupSpans(order)) {
    const group = order.slice(start, end)
    const listOrder = inListOrder !== undefined && group.some(e => e.kind === 'block' && inListOrder(e.connection.id))
    if (group.length === 1 || listOrder) {
      group.forEach((e, m) => {
        const amount = Math.min(askOf(e), rest)
        give(e, start + m, amount)
        rest -= amount
      })
      continue
    }
    const shares = group.map(askOf)
    // `rankedPairs` gives every member a valid weight or none; a hand-built group with some missing or invalid reads as equal.
    const given = group.map(e => e.weight)
    const taken = waterFill(rest, shares, given.every(validShare) ? given : undefined)
    group.forEach((e, m) => give(e, start + m, taken[m]))
    rest = Math.max(0, rest - taken.reduce((a, t) => a + t, 0))
  }
  return { grants, held: total - rest, entryGrants }
}

/**
 * Split `room` between members asking `shares` by `weights` (equal when omitted): each member still short is offered its
 * weighted part of what is left and takes at most what it lacks; what a covered member leaves goes round again. Every pass
 * either covers a member or ends the loop, so it stops after at most `shares.length` passes.
 */
export function waterFill(room: number, shares: readonly number[], weights?: readonly number[]): number[] {
  const taken = shares.map(() => 0)
  const w = weights ?? shares.map(() => 1)
  let short = shares.flatMap((s, m) => (s > 0 ? [m] : []))
  let left = room
  for (let pass = 0; pass < shares.length && short.length > 0 && left > 0; pass++) {
    const sum = short.reduce((a, m) => a + w[m], 0)
    const still: number[] = []
    let given = 0
    for (const m of short) {
      const lack = shares[m] - taken[m]
      const take = Math.min(lack, (left * w[m]) / sum)
      taken[m] += take
      given += take
      if (take < lack) still.push(m)
    }
    left = Math.max(0, left - given)
    if (still.length === short.length) break
    short = still
  }
  return taken
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
    else if (!blockIds.includes(e.blockId)) blockIds.push(e.blockId)
  }
  return { blockIds, extraPlace: extraPlace ?? blockIds.length }
}
