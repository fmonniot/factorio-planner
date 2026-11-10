import { useMemo } from 'react'
import type { GameData } from '../../data/types'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useSolverStore, selectBlockResult, selectFlows } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { itemConnections, itemMakers, sourcingText } from './sourcingText'

/**
 * The sentence for `itemId` in the active block, from the last solve: how the block gets the item under the
 * preset and the Import switch it has now. Empty without an active block or game data. Shared by every surface that
 * shows it, so they never disagree.
 */
export function useSourcingSentence(itemId: string, gameData: GameData | undefined): string {
  const block = useBlockStore(selectActiveBlock)
  const blocks = useBlockStore(s => s.blocks)
  const result = useSolverStore(selectBlockResult(block?.id))
  const flows = useSolverStore(selectFlows)
  const unit = useUiStore(s => s.rateUnit)

  const name = gameData?.items[itemId]?.name ?? itemId
  const mode = block?.itemSourcing[itemId]
  const noImport = block?.noImportItems.includes(itemId) ?? false

  return useMemo(
    () => block && gameData
      ? sourcingText({
          itemId, itemName: name, mode, noImport, unit,
          makers: itemMakers(block, gameData, result, itemId),
          connections: itemConnections(block, blocks, flows, itemId),
        })
      : '',
    [block, blocks, flows, gameData, result, itemId, name, mode, noImport, unit],
  )
}
