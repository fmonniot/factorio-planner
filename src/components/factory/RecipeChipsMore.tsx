import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { GameData } from '../../data/types'
import { useUiStore } from '../../store/uiStore'
import { useHoverPopup } from '../useHoverPopup'
import { ItemChip, type ItemChipVariant } from './ItemChip'
import { fmtItemRateText } from './ItemTile'

// ---------------------------------------------------------------------------
// RecipeChipsMore — the "+N" of a recipe row on a narrow screen, where a column holds at most two lines of chips: a button
// that opens, on click, a dialog listing the items the column has no room for ("More byproducts", "More ingredients"). The
// dialog sits under the button, above it when there is no room (the "+N" of an area row is anchored the same way). The
// button is one chip slot wide, so the row counts it as a chip. Rendered in a portal: the production table scrolls.
// ---------------------------------------------------------------------------

export interface HiddenItem {
  itemId: string
  ratePerSec: number
  /** Pre-formatted temperature requirement, drawn in the chip's corner. */
  temperature?: string
}

interface RecipeChipsMoreProps {
  column: 'byproducts' | 'ingredients'
  /** The hidden items only. */
  hidden: HiddenItem[]
  items: GameData['items']
}

export function RecipeChipsMore({ column, hidden, items }: RecipeChipsMoreProps) {
  const { open, hide, triggerProps, popupProps } = useHoverPopup<HTMLButtonElement>({ placement: 'below', mode: 'click' })
  const rateUnit = useUiStore(s => s.rateUnit)
  const empty = hidden.length === 0
  // A re-solve can empty the overflow while the dialog is open: close it, so it does not come back stale.
  useEffect(() => { if (empty) hide() }, [empty, hide])
  if (empty) return null
  const variant: ItemChipVariant = column === 'byproducts' ? 'byproduct' : 'ingredient'
  const title = `More ${column}`
  return (
    <>
      <button
        type="button"
        data-testid="recipe-chips-more"
        aria-label={`${hidden.length} more ${column}`}
        className="w-8 h-8 shrink-0 text-center text-[10px] text-gray-500 hover:text-gray-300"
        {...triggerProps}
      >
        +{hidden.length}
      </button>
      {open && createPortal(
        <div
          {...popupProps}
          aria-label={title}
          data-testid="recipe-chips-popup"
          // React events cross portals along the React tree: keep the row's context menu out of it.
          onContextMenu={e => e.stopPropagation()}
          className="z-[60] w-max max-w-xs max-h-[270px] overflow-y-auto p-2 text-xs bg-gray-900 border border-gray-700 rounded-lg shadow-2xl"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-gray-400">{title}</span>
            <button type="button" onClick={hide} className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300 hover:text-gray-100">
              Close
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {hidden.map(h => (
              <li key={h.itemId} className="flex items-center gap-2">
                <ItemChip item={items[h.itemId]} ratePerSec={h.ratePerSec} variant={variant} temperature={h.temperature} />
                <span className="truncate text-gray-200">{items[h.itemId]?.name ?? h.itemId}</span>
                <span className="ml-auto pl-2 font-mono tabular-nums text-gray-400">{fmtItemRateText(h.itemId, h.ratePerSec, rateUnit)}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}
