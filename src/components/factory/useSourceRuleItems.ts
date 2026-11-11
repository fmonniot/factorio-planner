import type { Block, GameData } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { sourceRuleItems } from './sourceRules'

const NO_ITEMS: ReadonlySet<string> = new Set()

/**
 * The ids of the items of `block` that have at least one source rule with an effect: the ones that get the marker
 * (`SourceRuleMarker.tsx`). `block` is any block of the plan, not only the active one. Computed once per block and
 * shared by every caller (`sourceRuleItems`), so each chip or row can ask without a cost of its own. Empty without
 * a block or game data.
 */
export function useSourceRuleItems(block: Block | undefined, gameData: GameData | undefined): ReadonlySet<string> {
  const blocks = useBlockStore(s => s.blocks)
  return block && gameData ? sourceRuleItems(block, gameData, blocks) : NO_ITEMS
}
