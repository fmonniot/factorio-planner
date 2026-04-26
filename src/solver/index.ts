import type { SubPlan, GameData, SolverResult } from '../data/types'
import type { SyntheticRecipe } from './v1/subplan'
import { solve as solveV1 } from './v1/index'
import { solve as solveV2 } from './v2/index'

export type { SyntheticRecipe } from './v1/subplan'

type SolverPlan = Pick<SubPlan, 'goals' | 'nodes'> & { solverVersion?: 1 | 2 }

export function solve(
  plan: SolverPlan,
  gameData: GameData,
  syntheticRecipes: Map<string, SyntheticRecipe> = new Map(),
): SolverResult {
  const version = plan.solverVersion ?? 1
  switch (version) {
    case 1: return solveV1(plan, gameData, syntheticRecipes)
    case 2: return solveV2(plan, gameData, syntheticRecipes)
  }
}
