import { useCallback } from 'react'
import { storedAreaRule } from '../../data/subPlanTree'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import type { SourceRulePart } from './sourceRules'

/**
 * Clears one rule of the active block: a preset goes back to the default, Import off goes back to on.
 * The item's other rule, if it has one, stays. For a part of an area's rule (`areaId`) it clears that part of the area's
 * rule; a `make-here` part, or a part that leaves a rule that does nothing (no key, no block rule to override), removes
 * the area's rule altogether, so the area follows the block again.
 */
export function useRemoveSourceRule(): (rule: Pick<SourceRulePart, 'itemId' | 'kind' | 'areaId'>) => void {
  const setMakeHere = useBlockStore(s => s.setMakeHere)
  const toggleImportOff = useBlockStore(s => s.toggleImportOff)
  const setAreaMakeHere = useBlockStore(s => s.setAreaMakeHere)
  const toggleAreaImportOff = useBlockStore(s => s.toggleAreaImportOff)
  const clearAreaRule = useBlockStore(s => s.clearAreaRule)
  return useCallback(({ itemId, kind, areaId }) => {
    if (areaId === undefined) {
      if (kind === 'import-off') toggleImportOff(itemId)
      else setMakeHere(itemId, undefined)
      return
    }
    const block = selectActiveBlock(useBlockStore.getState())
    const stored = block ? storedAreaRule(block.rootPlan, areaId, itemId) : undefined
    if (kind === 'make-here' || !block || !stored) {
      clearAreaRule(areaId, itemId)
      return
    }
    // What the area's rule would be, and whether the block has a rule of its own for the item that the area would then override.
    const after = kind === 'import-off' ? { ...stored, importOff: undefined } : { ...stored, makeHere: undefined }
    const doesNothing = after.makeHere === undefined && !after.importOff && (after.areasOff?.length ?? 0) === 0
    const blockRule = Object.hasOwn(block.sourceRules, itemId) ? block.sourceRules[itemId] : undefined
    const blockIsDefault = blockRule === undefined || (blockRule.makeHere === undefined && !blockRule.importOff)
    if (doesNothing && blockIsDefault) clearAreaRule(areaId, itemId)
    else if (kind === 'import-off') toggleAreaImportOff(areaId, itemId)
    else setAreaMakeHere(areaId, itemId, undefined)
  }, [setMakeHere, toggleImportOff, setAreaMakeHere, toggleAreaImportOff, clearAreaRule])
}
