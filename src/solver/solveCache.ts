/**
 * Memoises `solveBlock` per block. A block is re-solved only when its flattened
 * plan, the game data object or the caps on offer to it changed. Errors are
 * never stored. Up to `SLOTS_PER_BLOCK` entries are kept per block (most
 * recently used first), so the request probe, the first-round solve and the
 * settled solve of a block in a loop all survive, and so do the capped probe
 * and the second supply solve of a block with a short connections-first item.
 *
 * It also memoises the outcome of a whole cycle of requests (`LOOP_SLOTS` entries per member list,
 * most recently used first: a second request pass may key the same cycle differently), so a
 * warm solve runs none of the demand rounds; those entries are not counted by `size` or `has`,
 * and `retain` drops the member lists the solves since the last `retain` did not use.
 */
import type { AreaSourceRule, GameData, SolverGoal, RecipeNode, SolverResult, SourceRule } from '../data/types'
import type { AreaNeeds } from './servedAreas'
import type { KeySupply } from './build'

export interface BlockSolve {
  result: SolverResult
  received: Map<string, number>
  /** connection id → offered key → items/min delivered, for a split fluid supplied by key */
  receivedParts?: Map<string, Map<string, number>>
  /** unqualified flow key → items/min taken from the offers (a probe's range keys, a connection's supplied keys) */
  receivedKeys?: Map<string, number>
}

/** Entries kept per block. */
export const SLOTS_PER_BLOCK = 6

/** Cycle outcomes kept per member list. */
export const LOOP_SLOTS = 2

/** What the demand rounds of one cycle of requests decided. */
export interface RequestLoopSolve {
  /** request connection id → items/min requested, for every request of a member (round 1's when not converged). */
  shares: Map<string, number>
  /** take connection id → items/min credited, for the members' takes credited more than 0. */
  credits: Map<string, number>
  /** [take source, flow key (the item id for a plain item), leftover estimate after the members' takes]; a member source too (applied only when a take outside the cycle reads it). */
  credited: [string, string, number][]
  /** A split fluid: request connection id → items/min requested per range key. Optional so a hand-built outcome stays valid. */
  shareParts?: Map<string, Map<string, number>>
  /** A split fluid: take connection id → items/min credited per flow key. */
  creditParts?: Map<string, Map<string, number>>
  /** take connection id → items/min of its member's need still uncovered when the take was reached. */
  needs: Map<string, number>
  /** take connection ids reached before they could be credited. */
  uncredited: Set<string>
  /** member id → item id → the member's areas that need the item (its request probe in the last round); only members with areas. Optional so a hand-built outcome stays valid. */
  areaNeeds?: Map<string, AreaNeeds>
  /** member id → flow key → what the member's probe in the last round imported (`computeRequests`' `probes`); absent in a hand-built outcome (no short-supply check). */
  probes?: Map<string, Map<string, number>>
  rounds: number
  converged: boolean
}

export interface SolveCache {
  get(blockId: string, gameData: GameData, planKey: string, caps: Map<string, number>, supplyKey?: string): BlockSolve | undefined
  set(blockId: string, gameData: GameData, planKey: string, caps: Map<string, number>, solved: BlockSolve, supplyKey?: string): void
  /** The memoised outcome of the cycle with these members, if `key` and `gameData` match. */
  getRequestLoop(blockIds: string[], gameData: GameData, key: string): RequestLoopSolve | undefined
  setRequestLoop(blockIds: string[], gameData: GameData, key: string, solved: RequestLoopSolve): void
  delete(blockId: string): void
  /** Drop entries of blocks not in `blockIds`, and cycle entries not read or written since the last call. */
  retain(blockIds: ReadonlySet<string>): void
  clear(): void
  has(blockId: string): boolean
  readonly size: number
}

interface Entry {
  gameData: GameData
  planKey: string
  caps: [string, number][]
  /** what connections offer of the split fluids by key (see `keySupplyKey`); '' when none */
  supplyKey: string
  solved: BlockSolve
}

/** JSON would turn NaN and Infinity into null and drop the sign of -0. */
function exactNumberReplacer(_key: string, v: unknown): unknown {
  if (typeof v === 'number' && (!Number.isFinite(v) || Object.is(v, -0))) {
    return '#num:' + (Object.is(v, -0) ? '-0' : String(v))
  }
  return v
}

/** `value` as an exact string: numbers keep NaN, Infinity and the sign of zero. */
export function exactKey(value: unknown): string {
  return JSON.stringify(value, exactNumberReplacer)
}

/** A source-rule map as sorted entries with every key spelled out, so equal maps give equal keys. */
export function sourcingKey(s?: Record<string, SourceRule>): [string, string | null, boolean, boolean][] {
  return Object.entries(s ?? {})
    .map(([id, r]): [string, string | null, boolean, boolean] => [id, r.makeHere ?? null, r.importOff === true, r.leftoverOff === true])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * The areas of a plan as a key: an area's rules (`SolverArea.rules`) as entries sorted by item with every field spelled out, so equal
 * rule maps give equal keys whatever the order they were built in. An area without rules stays as it is.
 */
export function canonicalAreas<A extends { rules?: Record<string, AreaSourceRule> }>(areas: A[]): unknown[] {
  return areas.map(a => {
    if (!a.rules) return a
    const rules = Object.entries(a.rules)
      .map(([id, r]): [string, string | null, boolean, string[] | null] => [id, r.makeHere ?? null, r.importOff === true, r.areasOff ? [...r.areasOff].sort() : null])
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
    return { ...a, rules }
  })
}

/** Everything `solveBlock` reads from a flattened plan, as an exact string. */
export function planKey(plan: {
  goals: SolverGoal[]
  nodes: RecipeNode[]
  sourceRules?: Record<string, SourceRule>
  areas?: unknown
}): string {
  const key = [plan.goals, plan.nodes, sourcingKey(plan.sourceRules)]
  return exactKey(plan.areas ? [...key, canonicalAreas(plan.areas as { rules?: Record<string, AreaSourceRule> }[])] : key)
}

function sameCaps(stored: [string, number][], caps: Map<string, number>): boolean {
  if (stored.length !== caps.size) return false
  let i = 0
  for (const [k, v] of caps) {
    const [sk, sv] = stored[i++]
    if (sk !== k || !Object.is(sv, v)) return false
  }
  return true
}

function sameInputs(e: Entry, gameData: GameData, key: string, caps: Map<string, number>, supplyKey: string): boolean {
  return e.gameData === gameData && e.planKey === key && e.supplyKey === supplyKey && sameCaps(e.caps, caps)
}

/**
 * What `solveBlock` reads of the connections of split fluids, as an exact string: '' when none. Per fluid (sorted), the ranges of the
 * plan (versatility and the depth term follow from them, so a new range in another block changes the key), each connection's offer
 * per offered key and the `maxRate`s.
 */
export function keySupplyKey(keySupply: KeySupply): string {
  if (keySupply.size === 0) return ''
  return exactKey([...keySupply]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([fluid, s]) => [fluid, s.ranges, s.offers.map(o => [o.connectionId, o.tag, o.offer]), s.maxRates]))
}

export function createSolveCache(): SolveCache {
  const entries = new Map<string, Entry[]>() // most recently used first
  type LoopEntry = { blockIds: string[]; gameData: GameData; key: string; solved: RequestLoopSolve }
  const loops = new Map<string, LoopEntry[]>() // most recently used first
  const usedLoops = new Set<string>() // member lists read or written since the last retain
  return {
    getRequestLoop(blockIds, gameData, key) {
      const k = blockIds.join('\0')
      usedLoops.add(k)
      const list = loops.get(k)
      const i = list?.findIndex(e => e.gameData === gameData && e.key === key) ?? -1
      if (!list || i < 0) return undefined
      const [hit] = list.splice(i, 1)
      list.unshift(hit)
      return hit.solved
    },
    setRequestLoop(blockIds, gameData, key, solved) {
      const k = blockIds.join('\0')
      usedLoops.add(k)
      const entry: LoopEntry = { blockIds, gameData, key, solved }
      const list = loops.get(k) ?? []
      const i = list.findIndex(e => e.gameData === gameData && e.key === key)
      if (i >= 0) list.splice(i, 1)
      list.unshift(entry)
      list.length = Math.min(list.length, LOOP_SLOTS)
      loops.set(k, list)
    },
    get(blockId, gameData, key, caps, supplyKey = '') {
      const list = entries.get(blockId)
      if (!list) return undefined
      const i = list.findIndex(e => sameInputs(e, gameData, key, caps, supplyKey))
      if (i < 0) return undefined
      const [hit] = list.splice(i, 1)
      list.unshift(hit)
      return hit.solved
    },
    set(blockId, gameData, key, caps, solved, supplyKey = '') {
      const entry: Entry = { gameData, planKey: key, caps: [...caps], supplyKey, solved }
      const list = entries.get(blockId)
      if (!list) {
        entries.set(blockId, [entry])
        return
      }
      const i = list.findIndex(e => sameInputs(e, gameData, key, caps, supplyKey))
      if (i >= 0) list[i] = entry
      else {
        list.unshift(entry)
        list.length = Math.min(list.length, SLOTS_PER_BLOCK)
      }
    },
    delete(blockId) {
      entries.delete(blockId)
    },
    retain(blockIds) {
      for (const id of [...entries.keys()]) if (!blockIds.has(id)) entries.delete(id)
      for (const [k, list] of [...loops]) if (!usedLoops.has(k) || list.some(e => e.blockIds.some(id => !blockIds.has(id)))) loops.delete(k)
      usedLoops.clear()
    },
    clear() {
      entries.clear()
      loops.clear()
      usedLoops.clear()
    },
    has: blockId => entries.has(blockId),
    get size() {
      return entries.size
    },
  }
}
