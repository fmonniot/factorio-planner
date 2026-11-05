import type { GameData, SolvedNode } from '../../data/types'
import { rowProductAmount } from '../../solver/build'

/** Solved items-per-run of the primary product; undefined unless strictly positive. */
export function solvedPrimaryPerRun(
  primaryItemId: string | undefined,
  solvedNode: SolvedNode | undefined,
): number | undefined {
  if (!primaryItemId || !solvedNode || !(solvedNode.throughput > 0)) return undefined
  const out = solvedNode.outputRates[primaryItemId]
  if (out === undefined || !(out > 0)) return undefined
  const v = out / solvedNode.throughput
  return Number.isFinite(v) ? v : undefined
}

/**
 * Items of `primaryItemId` produced per recipe execution, productivity included.
 * Derived from the solved node when available (so it follows modules and
 * productivity); otherwise from the recipe's declared product amounts.
 * Converts the stored pin (executions/min) to the primary product's rate.
 */
export function primaryItemPerRun(
  recipe: GameData['recipes'][string],
  primaryItemId: string | undefined,
  solvedNode: SolvedNode | undefined,
  heatBonus = 0,
): number {
  const solved = solvedPrimaryPerRun(primaryItemId, solvedNode)
  if (solved !== undefined) return solved
  const declared = recipe.products
    .filter(p => p.itemId === primaryItemId)
    .reduce((sum, p) => sum + rowProductAmount(p, 0, heatBonus), 0)
  return declared > 0 ? declared : 1
}

/** The rate (executions/min) a row is pinned at when the user starts pinning it: where it runs now, at least 1. */
export function pinSeedRate(solvedNode: SolvedNode | undefined): number {
  return Math.max(solvedNode?.throughput ?? 0, 1)
}
