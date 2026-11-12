import { useMemo } from 'react'
import type { Block, GameData } from '../../data/types'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useSolverStore, selectBlockResult, selectFlows } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { itemConnections, itemMakers, sourcingText } from './sourcingText'

/**
 * The sentence for `itemId` in `block`, any block of the plan, from the last solve: how the block gets the item under
 * the preset and the Import switch it has now. Empty without a block or game data. The one implementation behind every
 * surface that shows a sentence, so they never disagree.
 */
export function useBlockSourcingSentence(block: Block | undefined, itemId: string, gameData: GameData | undefined): string {
  const blocks = useBlockStore(s => s.blocks)
  const result = useSolverStore(selectBlockResult(block?.id))
  const flows = useSolverStore(selectFlows)
  const unit = useUiStore(s => s.rateUnit)

  const name = gameData?.items[itemId]?.name ?? itemId
  const rule = block?.sourceRules[itemId]

  return useMemo(
    () => block && gameData
      ? sourcingText({
          itemId, itemName: name, rule, unit,
          makers: itemMakers(block, gameData, result, itemId),
          connections: itemConnections(block, blocks, flows, itemId),
        })
      : '',
    [block, blocks, flows, gameData, result, itemId, name, rule, unit],
  )
}

/** The sentence for `itemId` in the active block (`useBlockSourcingSentence`). */
export function useSourcingSentence(itemId: string, gameData: GameData | undefined): string {
  return useBlockSourcingSentence(useBlockStore(selectActiveBlock), itemId, gameData)
}
