import { useMemo } from 'react'
import { applyDefaultMachineOverrides, computeHorizon, type Horizon } from '../data/horizon'
import type { GameData } from '../data/types'
import { useBlockStore } from './blockStore'
import { useGameDataStore, selectGameData } from './gameDataStore'

interface CacheEntry {
  targets: readonly string[]
  /** The horizon before the overrides are layered on. */
  base: Horizon
  overrides: Readonly<Record<string, string>>
  horizon: Horizon
}

const cache = new WeakMap<GameData, CacheEntry>()

/**
 * The horizon of a game-data set under the given targets and default-machine
 * overrides, computed once per (gameData, targets array, overrides object): hooks
 * and the solver wiring share it. Callers must pass a new array / object whenever
 * the targets / overrides change. Only the default machines depend on the overrides,
 * so a change there reuses the rest of the horizon.
 */
export function horizonFor(
  gameData: GameData,
  targetIds: readonly string[],
  overrides: Readonly<Record<string, string>>,
): Horizon {
  const hit = cache.get(gameData)
  if (hit && hit.targets === targetIds && hit.overrides === overrides) return hit.horizon
  const base = hit && hit.targets === targetIds ? hit.base : computeHorizon(gameData, targetIds)
  const defaultMachines = applyDefaultMachineOverrides(gameData, base.machineIds, base.defaultMachines, overrides)
  const horizon = defaultMachines === base.defaultMachines ? base : { ...base, defaultMachines }
  cache.set(gameData, { targets: targetIds, base, overrides, horizon })
  return horizon
}

/** The plan's research horizon over `gameData`, with its default-machine overrides applied. */
export function useHorizon(gameData: GameData): Horizon {
  const targets = useBlockStore(s => s.horizonTechnologyIds)
  const overrides = useBlockStore(s => s.defaultMachineOverrides)
  return useMemo(() => horizonFor(gameData, targets, overrides), [gameData, targets, overrides])
}

/** Recipe ids offered under the plan's research horizon; null = no limit. */
export function useAvailableRecipeIds(): Set<string> | null {
  const gameData = useGameDataStore(selectGameData)
  const targets = useBlockStore(s => s.horizonTechnologyIds)
  const overrides = useBlockStore(s => s.defaultMachineOverrides)
  return useMemo(
    () => (gameData ? horizonFor(gameData, targets, overrides).recipeIds : null),
    [gameData, targets, overrides],
  )
}
