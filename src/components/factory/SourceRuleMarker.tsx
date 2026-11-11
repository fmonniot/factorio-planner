import type { Block, GameData } from '../../data/types'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useBlockSourcingSentence, useSourcingSentence } from './useSourcingSentence'

// ---------------------------------------------------------------------------
// The source rule marker: the small grey dot that says "this item has a source rule with an effect". It only shows the rule:
// it is an image with the item's sentence as its tooltip and accessible name, and a click on it does nothing. The rule is
// set in the Comes from control, reached from a right-click on an ingredient chip or from the side panel's Change….
// One component for every surface. `SourceRuleMarker` draws it and knows nothing of where it sits or of the stores;
// `ItemSourceRuleMarker` is the same marker for an item of the active block, `BlockSourceRuleMarker` for an item of any
// block. Which items of a block get one is `useSourceRuleItems` (`useSourceRuleItems.ts`).
// ---------------------------------------------------------------------------

/** Shown when there is no sentence to read (no active block, no game data). */
const FALLBACK_LABEL = 'Has a source rule'

/**
 * The 6px dot is centred in a 14px box, the size of the pin badge, so the two line up in a badge corner and the
 * box is larger than what is drawn (it carries the tooltip).
 */
const BOX_CLASS = 'w-3.5 h-3.5 shrink-0 inline-flex items-center justify-center rounded-full'
const DOT_CLASS = 'block w-1.5 h-1.5 rounded-full bg-gray-400 ring-1 ring-gray-900'

interface SourceRuleMarkerProps {
  /** The item's sentence (`sourcingText`): the tooltip and the accessible name. */
  sentence: string
  /** Written as `data-item-id`, for the surfaces where the marker is not inside the item's own element. */
  itemId?: string
}

/**
 * The marker itself: an inline 14px box holding the dot, to be placed by its parent (a badge corner is
 * `absolute -top-1 -right-1`). It is not interactive: a click on it is a click on whatever it sits on.
 */
export function SourceRuleMarker({ sentence, itemId }: SourceRuleMarkerProps) {
  const label = sentence || FALLBACK_LABEL
  return (
    <span role="img" aria-label={label} title={label} data-testid="source-rule-marker" data-item-id={itemId} className={BOX_CLASS}>
      <span className={DOT_CLASS} />
    </span>
  )
}

/** The marker of an item of the active block: its sentence is the one every other surface shows (`useSourcingSentence`). Render it only for an item `useSourceRuleItems` holds; it does not test that itself. */
export function ItemSourceRuleMarker({ itemId, gameData }: { itemId: string; gameData: GameData | undefined }) {
  const sentence = useSourcingSentence(itemId, gameData)
  return <SourceRuleMarker sentence={sentence} itemId={itemId} />
}

/**
 * `ItemSourceRuleMarker` for the summary strip, whose slots and chips are handed the items and not the game data:
 * it reads the game data from its store.
 */
export function SummarySourceRuleMarker({ itemId }: { itemId: string }) {
  const gameData = useGameDataStore(selectGameData)
  return <ItemSourceRuleMarker itemId={itemId} gameData={gameData} />
}

interface BlockSourceRuleMarkerProps {
  /** The block that holds the rule: any block of the plan. */
  block: Block
  itemId: string
  gameData: GameData | undefined
}

/**
 * The marker of an item of `block`, for the surfaces that show blocks other than the active one (the areas matrix,
 * the block graph): its sentence is the item's in that block (`useBlockSourcingSentence`). Like the others it does
 * not test that the item has a rule.
 */
export function BlockSourceRuleMarker({ block, itemId, gameData }: BlockSourceRuleMarkerProps) {
  const sentence = useBlockSourcingSentence(block, itemId, gameData)
  return <SourceRuleMarker sentence={sentence} itemId={itemId} />
}
