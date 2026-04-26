import type { SubPlan, GameData, SolverResult } from '../../data/types'
import type { SyntheticRecipe } from '../v1/subplan'

export function solve(
  _plan: Pick<SubPlan, 'goals' | 'nodes'>,
  _gameData: GameData,
  _syntheticRecipes: Map<string, SyntheticRecipe> = new Map(),
): SolverResult {
  throw new Error('v2 solver not implemented')
}
