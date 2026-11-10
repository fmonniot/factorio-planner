import { useCallback } from 'react'
import { useBlockStore } from '../../store/blockStore'
import type { SourceRule } from './sourceRules'

/**
 * Clears one rule of the active block: a preset goes back to the default, Import off goes back to on.
 * The item's other rule, if it has one, stays.
 */
export function useRemoveSourceRule(): (rule: Pick<SourceRule, 'itemId' | 'kind'>) => void {
  const setItemSourcing = useBlockStore(s => s.setItemSourcing)
  const toggleNoImportItem = useBlockStore(s => s.toggleNoImportItem)
  return useCallback(({ itemId, kind }) => {
    if (kind === 'import-off') toggleNoImportItem(itemId)
    else setItemSourcing(itemId, undefined)
  }, [setItemSourcing, toggleNoImportItem])
}
