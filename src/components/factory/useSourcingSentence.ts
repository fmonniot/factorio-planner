import { useMemo } from 'react'
import type { Block, GameData } from '../../data/types'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useSolverStore, selectBlockResult, selectFlows } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { areaName as areaNameOf, storedAreaRule } from '../../data/subPlanTree'
import { itemConnections, itemMakers, sourcingText } from './sourcingText'

/**
 * The sentence for `itemId` in `block`, any block of the plan, from the last solve: how the block gets the item under
 * the preset and the Import switch it has now. With `areaId`, the sentence of that area: its own rule when it has one (else the block's),
 * its rows, and its name in front. Empty without a block or game data. The one implementation behind every
 * surface that shows a sentence, so they never disagree.
 */
export function useBlockSourcingSentence(block: Block | undefined, itemId: string, gameData: GameData | undefined, areaId?: string): string {
  const blocks = useBlockStore(s => s.blocks)
  const result = useSolverStore(selectBlockResult(block?.id))
  const flows = useSolverStore(selectFlows)
  const unit = useUiStore(s => s.rateUnit)

  const name = gameData?.items[itemId]?.name ?? itemId
  const rule = block && areaId !== undefined
    ? (storedAreaRule(block.rootPlan, areaId, itemId) ?? block.sourceRules[itemId])
    : block?.sourceRules[itemId]
  const areaName = block && areaId !== undefined ? areaNameOf(block.rootPlan, areaId) : undefined

  return useMemo(
    () => block && gameData
      ? sourcingText({
          itemId, itemName: name, rule, unit, solved: result !== undefined,
          areaName,
          makers: itemMakers(block, gameData, result, itemId, areaId),
          connections: itemConnections(block, blocks, flows, itemId),
        })
      : '',
    [block, blocks, flows, gameData, result, itemId, name, rule, unit, areaId, areaName],
  )
}

/** The sentence for `itemId` in the active block (`useBlockSourcingSentence`). */
export function useSourcingSentence(itemId: string, gameData: GameData | undefined, areaId?: string): string {
  return useBlockSourcingSentence(useBlockStore(selectActiveBlock), itemId, gameData, areaId)
}
