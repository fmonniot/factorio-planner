import type { SubPlan, GameData, SolverResult } from '../data/types'
import type { SyntheticRecipe } from './subplan'
import { solve as solveV2 } from './v2/index'

export type { SyntheticRecipe } from './subplan'

type SolverPlan = Pick<SubPlan, 'goals' | 'nodes'> & {
  noImportItems?: string[]
}

export function solve(
  plan: SolverPlan,
  gameData: GameData,
  syntheticRecipes: Map<string, SyntheticRecipe> = new Map(),
): SolverResult {
  return solveV2(plan, gameData, syntheticRecipes)
}
