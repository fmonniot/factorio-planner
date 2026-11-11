import type { GameData } from '../../data/types'
import { useUiStore } from '../../store/uiStore'
import { useSourcingSentence } from './useSourcingSentence'

// ---------------------------------------------------------------------------
// The source rule marker: the small grey dot that says "this item has a source rule with an effect".
// One component for every surface. `SourceRuleMarker` draws it and knows nothing of where it sits or of the
// stores; `ItemSourceRuleMarker` is the same marker for an item of the active block. Which items of a block
// get one is `useSourceRuleItems` (`useSourceRuleItems.ts`).
// ---------------------------------------------------------------------------

/** Shown when there is no sentence to read (no active block, no game data). */
const FALLBACK_LABEL = 'Has a source rule'

/**
 * The 6px dot is centred in a 14px box, the size of the pin badge, so the two line up in a badge corner and the
 * button is larger than what is drawn.
 */
const BOX_CLASS = 'group/marker w-3.5 h-3.5 shrink-0 inline-flex items-center justify-center rounded-full'
const DOT_CLASS = 'block w-1.5 h-1.5 rounded-full bg-gray-400 ring-1 ring-gray-900'

interface SourceRuleMarkerProps {
  /** The item's sentence (`sourcingText`): the tooltip and the accessible name. */
  sentence: string
  /**
   * Makes the marker a button that calls this on a click or on Enter / Space; the click does not reach what the
   * marker sits on. Without it the marker is an image: it shows the rule and does nothing.
   */
  onOpen?: () => void
  /** Written as `data-item-id`, for the surfaces where the marker is not inside the item's own element. */
  itemId?: string
}

/**
 * The marker itself: an inline 14px box holding the dot, to be placed by its parent (a badge corner is
 * `absolute -top-1 -right-1`). When `onOpen` is given it renders a `<button>`, so the parent must not be one.
 */
export function SourceRuleMarker({ sentence, onOpen, itemId }: SourceRuleMarkerProps) {
  const label = sentence || FALLBACK_LABEL
  if (!onOpen) {
    return (
      <span role="img" aria-label={label} title={label} data-testid="source-rule-marker" data-item-id={itemId} className={BOX_CLASS}>
        <span className={DOT_CLASS} />
      </span>
    )
  }
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid="source-rule-marker"
      data-item-id={itemId}
      onClick={e => { e.stopPropagation(); onOpen() }}
      className={`${BOX_CLASS} cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-teal-400`}
    >
      <span className={`${DOT_CLASS} group-hover/marker:bg-gray-100 group-focus-visible/marker:bg-gray-100`} />
    </button>
  )
}

interface ItemSourceRuleMarkerProps {
  itemId: string
  gameData: GameData | undefined
  /** False: the marker only shows the rule. By default a click opens the item's Ingredients slot. */
  opens?: boolean
}

/**
 * The marker of an item of the active block: its sentence is the one every other surface shows
 * (`useSourcingSentence`), and a click opens the item's Ingredients slot (`uiStore.openIngredientSlot`). Render it
 * only for an item `useSourceRuleItems` holds; it does not test that itself.
 */
export function ItemSourceRuleMarker({ itemId, gameData, opens = true }: ItemSourceRuleMarkerProps) {
  const sentence = useSourcingSentence(itemId, gameData)
  const openIngredientSlot = useUiStore(s => s.openIngredientSlot)
  return <SourceRuleMarker sentence={sentence} itemId={itemId} onOpen={opens ? () => openIngredientSlot(itemId) : undefined} />
}
