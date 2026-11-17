import { useCallback } from 'react'
import { repeatsBlockRule, storedAreaRule } from '../../data/subPlanTree'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import type { AreaSourceRule } from '../../data/types'
import type { SourceRulePart } from './sourceRules'

/**
 * Clears one rule of the active block: a preset goes back to the default, Import off goes back to on.
 * The item's other rule, if it has one, stays. For a part of an area's rule (`areaId`) it clears that part of the area's
 * rule; a `make-here` or `import-on` part, a rule that only repeats the block's, or a part that leaves such a rule, removes
 * the area's rule altogether, so the area follows the block again, except that an area with switches (`areasOff`) keeps them.
 * A `takes-nothing` part switches that one area back on.
 */
export function useRemoveSourceRule(): (rule: Pick<SourceRulePart, 'itemId' | 'kind' | 'areaId' | 'otherAreaId'>) => void {
  const setMakeHere = useBlockStore(s => s.setMakeHere)
  const toggleImportOff = useBlockStore(s => s.toggleImportOff)
  const setAreaMakeHere = useBlockStore(s => s.setAreaMakeHere)
  const toggleAreaImportOff = useBlockStore(s => s.toggleAreaImportOff)
  const toggleAreaSupplier = useBlockStore(s => s.toggleAreaSupplier)
  const clearAreaRule = useBlockStore(s => s.clearAreaRule)
  return useCallback(({ itemId, kind, areaId, otherAreaId }) => {
    if (areaId === undefined) {
      if (kind === 'import-off') toggleImportOff(itemId)
      else setMakeHere(itemId, undefined)
      return
    }
    const block = selectActiveBlock(useBlockStore.getState())
    const stored = block ? storedAreaRule(block.rootPlan, areaId, itemId) : undefined
    if (!block || !stored) {
      clearAreaRule(areaId, itemId)
      return
    }
    // What is left of the area's rule once the part goes. A part that says "back to the block" (make-here, import-on) takes the
    // whole rule with it, unless the area has switches to keep; a rule that only repeats the block's goes whichever part is asked
    // for (clearing one part of it would make the area differ from the block).
    const switched = (stored.areasOff?.length ?? 0) > 0
    const blockRule = Object.hasOwn(block.sourceRules, itemId) ? block.sourceRules[itemId] : undefined
    let after: AreaSourceRule | undefined
    if (kind === 'takes-nothing') after = { ...stored, areasOff: (stored.areasOff ?? []).filter(id => id !== otherAreaId) }
    else if (kind === 'import-off') after = { ...stored, importOff: undefined }
    else if (kind === 'make-here') after = switched ? { ...stored, makeHere: blockRule?.makeHere } : undefined
    else if (kind === 'import-on') after = switched ? { ...stored, importOff: stored.importOff ? undefined : true } : undefined
    else after = { ...stored, makeHere: undefined }
    if (after === undefined || (kind !== 'takes-nothing' && repeatsBlockRule(stored, block.sourceRules, itemId)) || repeatsBlockRule(after, block.sourceRules, itemId)) {
      clearAreaRule(areaId, itemId)
      return
    }
    // Otherwise write the one field that changed.
    if (kind === 'takes-nothing') { if (otherAreaId !== undefined) toggleAreaSupplier(areaId, itemId, otherAreaId) }
    else if (kind === 'make-here') setAreaMakeHere(areaId, itemId, after.makeHere)
    else if (kind === 'import-off' || kind === 'import-on') toggleAreaImportOff(areaId, itemId)
    else setAreaMakeHere(areaId, itemId, undefined)
  }, [setMakeHere, toggleImportOff, setAreaMakeHere, toggleAreaImportOff, toggleAreaSupplier, clearAreaRule])
}
