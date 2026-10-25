/**
 * Memoises `solveBlock` per block. A block is re-solved only when its flattened
 * plan, the game data object or the caps on offer to it changed. Errors are
 * never stored. Up to `SLOTS_PER_BLOCK` entries are kept per block (most
 * recently used first), so the first-round and the settled solve of a block in
 * a loop both survive.
 */
import type { GameData, ProductionGoal, RecipeNode, SolverResult } from '../data/types'

export interface BlockSolve {
  result: SolverResult
  received: Map<string, number>
}

/** Entries kept per block. */
export const SLOTS_PER_BLOCK = 2

export interface SolveCache {
  get(blockId: string, gameData: GameData, planKey: string, caps: Map<string, number>): BlockSolve | undefined
  set(blockId: string, gameData: GameData, planKey: string, caps: Map<string, number>, solved: BlockSolve): void
  delete(blockId: string): void
  /** Drop entries of blocks not in `blockIds`. */
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

/** Everything `solveBlock` reads from a flattened plan, as an exact string. */
export function planKey(plan: { goals: ProductionGoal[]; nodes: RecipeNode[]; noImportItems?: string[] }): string {
  return JSON.stringify([plan.goals, plan.nodes, plan.noImportItems ?? []], exactNumberReplacer)
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
  return {
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
    },
    clear() {
      entries.clear()
    },
    has: blockId => entries.has(blockId),
    get size() {
      return entries.size
    },
  }
}
