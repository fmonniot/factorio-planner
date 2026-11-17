import type { Block, GameData } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { areaRuleItems, rowRuleItems } from './sourceRules'

const NO_ITEMS: ReadonlySet<string> = new Set()
const NO_AREAS: ReadonlyMap<string, ReadonlySet<string>> = new Map()

/**
 * The ids of the items of `block` that have at least one source rule with an effect: the ones that get the marker
 * (`SourceRuleMarker.tsx`). `block` is any block of the plan, not only the active one. Computed once per block and
 * shared by every caller (`sourceRuleItems`), so each chip or row can ask without a cost of its own. Empty without
 * a block or game data. For the rows of an area (`areaId`) it is the items whose rule shows on them: the area's own rule
 * replaces the block's for an item (`rowRuleItems`).
 */
export function useSourceRuleItems(block: Block | undefined, gameData: GameData | undefined, areaId?: string): ReadonlySet<string> {
  const blocks = useBlockStore(s => s.blocks)
  return block && gameData ? rowRuleItems(block, gameData, blocks, areaId) : NO_ITEMS
}

/** Per area of `block`, the items its own rules change (`areaRuleItems`): the areas matrix marks the columns that have some. */
export function useAreaRuleItems(block: Block | undefined, gameData: GameData | undefined): ReadonlyMap<string, ReadonlySet<string>> {
  const blocks = useBlockStore(s => s.blocks)
  return block && gameData ? areaRuleItems(block, gameData, blocks) : NO_AREAS
}
