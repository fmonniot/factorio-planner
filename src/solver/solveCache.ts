/**
 * Memoises `solveBlock` per block. A block is re-solved only when its flattened
 * plan, the game data object or the caps on offer to it changed. Errors are
 * never stored. Up to `SLOTS_PER_BLOCK` entries are kept per block (most
 * recently used first), so the request probe, the first-round solve and the
 * settled solve of a block in a loop all survive.
 *
 * It also memoises the outcome of a whole cycle of requests (one entry per member list), so a
 * warm solve runs none of the demand rounds; those entries are not counted by `size` or `has`,
 * and `retain` drops the ones the solve since the last `retain` did not use.
 */
import type { GameData, SolverGoal, RecipeNode, SolverResult } from '../data/types'

export interface BlockSolve {
  result: SolverResult
  received: Map<string, number>
}

/** Entries kept per block. */
export const SLOTS_PER_BLOCK = 3

/** What the demand rounds of one cycle of requests decided. */
export interface RequestLoopSolve {
  /** request connection id → items/min requested, for every request of a member (round 1's when not converged). */
  shares: Map<string, number>
  /** take connection id → items/min credited, for the members' takes credited more than 0. */
  credits: Map<string, number>
  /** [take source, item, leftover estimate after the members' takes]. */
  credited: [string, string, number][]
  rounds: number
  converged: boolean
}

export interface SolveCache {
  get(blockId: string, gameData: GameData, planKey: string, caps: Map<string, number>): BlockSolve | undefined
  set(blockId: string, gameData: GameData, planKey: string, caps: Map<string, number>, solved: BlockSolve): void
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

/** Everything `solveBlock` reads from a flattened plan, as an exact string. */
export function planKey(plan: {
  goals: SolverGoal[]
  nodes: RecipeNode[]
  noImportItems?: string[]
  connectionsFirstItems?: string[]
  areas?: unknown
}): string {
  const key = [plan.goals, plan.nodes, plan.noImportItems ?? [], plan.connectionsFirstItems ?? []]
  return exactKey(plan.areas ? [...key, plan.areas] : key)
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

function sameInputs(e: Entry, gameData: GameData, key: string, caps: Map<string, number>): boolean {
  return e.gameData === gameData && e.planKey === key && sameCaps(e.caps, caps)
}

export function createSolveCache(): SolveCache {
  const entries = new Map<string, Entry[]>() // most recently used first
  const loops = new Map<string, { blockIds: string[]; gameData: GameData; key: string; solved: RequestLoopSolve }>()
  const usedLoops = new Set<string>() // member lists read or written since the last retain
  return {
    getRequestLoop(blockIds, gameData, key) {
      const k = blockIds.join('\0')
      usedLoops.add(k)
      const hit = loops.get(k)
      return hit && hit.gameData === gameData && hit.key === key ? hit.solved : undefined
    },
    setRequestLoop(blockIds, gameData, key, solved) {
      const k = blockIds.join('\0')
      usedLoops.add(k)
      loops.set(k, { blockIds, gameData, key, solved })
    },
    get(blockId, gameData, key, caps) {
      const list = entries.get(blockId)
      if (!list) return undefined
      const i = list.findIndex(e => sameInputs(e, gameData, key, caps))
      if (i < 0) return undefined
      const [hit] = list.splice(i, 1)
      list.unshift(hit)
      return hit.solved
    },
    set(blockId, gameData, key, caps, solved) {
      const entry: Entry = { gameData, planKey: key, caps: [...caps], solved }
      const list = entries.get(blockId)
      if (!list) {
        entries.set(blockId, [entry])
        return
      }
      const i = list.findIndex(e => sameInputs(e, gameData, key, caps))
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
      for (const [k, e] of [...loops]) if (!usedLoops.has(k) || e.blockIds.some(id => !blockIds.has(id))) loops.delete(k)
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
