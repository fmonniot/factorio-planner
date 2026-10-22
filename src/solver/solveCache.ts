/**
 * Memoises `solveBlock` per block. A block is re-solved only when its flattened
 * plan, the game data object or the caps on offer to it changed. Errors are
 * never stored.
 */
import type { GameData, ProductionGoal, RecipeNode, SolverResult } from '../data/types'

export interface BlockSolve {
  result: SolverResult
  received: Map<string, number>
}

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

export function createSolveCache(): SolveCache {
  const entries = new Map<string, Entry>()
  return {
    get(blockId, gameData, key, caps) {
      const e = entries.get(blockId)
      if (!e || e.gameData !== gameData || e.planKey !== key || !sameCaps(e.caps, caps)) return undefined
      return e.solved
    },
    set(blockId, gameData, key, caps, solved) {
      entries.set(blockId, { gameData, planKey: key, caps: [...caps], solved })
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
