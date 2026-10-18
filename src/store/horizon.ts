import { useMemo } from 'react'
import { availableRecipeIds } from '../data/horizon'
import { useBlockStore } from './blockStore'
import { useGameDataStore, selectGameData } from './gameDataStore'

/** Recipe ids offered under the plan's research horizon; null = no limit. */
export function useAvailableRecipeIds(): Set<string> | null {
  const gameData = useGameDataStore(selectGameData)
  const targets = useBlockStore(s => s.horizonTechnologyIds)
  return useMemo(
    () => (gameData ? availableRecipeIds(gameData, targets) : null),
    [gameData, targets],
  )
}
