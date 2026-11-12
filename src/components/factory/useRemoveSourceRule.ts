import { useCallback } from 'react'
import { useBlockStore } from '../../store/blockStore'
import type { SourceRulePart } from './sourceRules'

/**
 * Clears one rule of the active block: a preset goes back to the default, Import off goes back to on.
 * The item's other rule, if it has one, stays.
 */
export function useRemoveSourceRule(): (rule: Pick<SourceRulePart, 'itemId' | 'kind'>) => void {
  const setMakeHere = useBlockStore(s => s.setMakeHere)
  const toggleImportOff = useBlockStore(s => s.toggleImportOff)
  return useCallback(({ itemId, kind }) => {
    if (kind === 'import-off') toggleImportOff(itemId)
    else setMakeHere(itemId, undefined)
  }, [setMakeHere, toggleImportOff])
}
