import { useMemo } from 'react'
import { computeHorizon, type Horizon } from '../data/horizon'
import type { GameData } from '../data/types'
import { useBlockStore } from './blockStore'
import { useGameDataStore, selectGameData } from './gameDataStore'

const cache = new WeakMap<GameData, { targets: readonly string[]; horizon: Horizon }>()

/**
 * The horizon of a game-data set under the given targets, computed once per
 * (gameData, targets array): hooks and the solver wiring share it. Callers must
 * pass a new targets array whenever the targets change.
 */
export function horizonFor(gameData: GameData, targetIds: readonly string[]): Horizon {
  const hit = cache.get(gameData)
  if (hit && hit.targets === targetIds) return hit.horizon
  const horizon = computeHorizon(gameData, targetIds)
  cache.set(gameData, { targets: targetIds, horizon })
  return horizon
}

/** The plan's research horizon over `gameData`. */
export function useHorizon(gameData: GameData): Horizon {
  const targets = useBlockStore(s => s.horizonTechnologyIds)
  return useMemo(() => horizonFor(gameData, targets), [gameData, targets])
}

/** Recipe ids offered under the plan's research horizon; null = no limit. */
export function useAvailableRecipeIds(): Set<string> | null {
  const gameData = useGameDataStore(selectGameData)
  const targets = useBlockStore(s => s.horizonTechnologyIds)
  return useMemo(
    () => (gameData ? horizonFor(gameData, targets).recipeIds : null),
    [gameData, targets],
  )
}
