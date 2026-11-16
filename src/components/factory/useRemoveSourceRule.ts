import { useCallback } from 'react'
import { storedAreaRule } from '../../data/subPlanTree'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import type { AreaSourceRule, SourceRule } from '../../data/types'
import type { SourceRulePart } from './sourceRules'

/** Whether an area's `rule` says what the block's rule for the item already says (and switches no area off): then it can go. */
function repeatsBlock(rule: AreaSourceRule, blockRules: Record<string, SourceRule>, itemId: string): boolean {
  const blockRule = Object.hasOwn(blockRules, itemId) ? blockRules[itemId] : undefined
  return rule.makeHere === blockRule?.makeHere && !rule.importOff === !blockRule?.importOff && (rule.areasOff?.length ?? 0) === 0
}

/**
 * Clears one rule of the active block: a preset goes back to the default, Import off goes back to on.
 * The item's other rule, if it has one, stays. For a part of an area's rule (`areaId`) it clears that part of the area's
 * rule; a `make-here` or `import-on` part, a rule that only repeats the block's, or a part that leaves such a rule, removes
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
    // A part that says "back to the block" (make-here, import-on) removes the whole rule; so does a rule that only repeats the
    // block's, whichever part is asked for: clearing one part of it would make the area differ from the block.
    if (kind === 'make-here' || kind === 'import-on' || !block || !stored || repeatsBlock(stored, block.sourceRules, itemId)) {
      clearAreaRule(areaId, itemId)
      return
    }
    const after = kind === 'import-off' ? { ...stored, importOff: undefined } : { ...stored, makeHere: undefined }
    if (repeatsBlock(after, block.sourceRules, itemId)) clearAreaRule(areaId, itemId)
    else if (kind === 'import-off') toggleAreaImportOff(areaId, itemId)
    else setAreaMakeHere(areaId, itemId, undefined)
  }, [setMakeHere, toggleImportOff, setAreaMakeHere, toggleAreaImportOff, clearAreaRule])
}
