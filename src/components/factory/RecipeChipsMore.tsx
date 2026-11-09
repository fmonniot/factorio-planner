import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { GameData } from '../../data/types'
import { useUiStore } from '../../store/uiStore'
import { useHoverPopup } from '../useHoverPopup'
import { fmtItemRateText } from './ItemTile'

// ---------------------------------------------------------------------------
// RecipeChipsMore — the "+N" of a recipe row on a narrow screen, where a column holds at most two lines of chips: a button
// that opens, on click, a dialog listing the items the column has no room for ("More byproducts", "More ingredients"). The
// dialog sits under the button, above it when there is no room (the "+N" of an area row is anchored the same way). The
// button is one chip slot wide, so the row counts it as a chip. Rendered in a portal: the production table scrolls.
// The chips in the dialog are the row's own chips (`renderChip`): they keep their actions (make primary, find a producer,
// the byproduct menu), and an action closes the dialog.
// ---------------------------------------------------------------------------

interface RecipeChipsMoreProps {
  column: 'byproducts' | 'ingredients'
  /** The hidden items only: item id and rate per minute. */
  hidden: [string, number][]
  items: GameData['items']
  /** The chip of an item, as the row draws it when it fits. */
  renderChip: (entry: [string, number]) => ReactNode
}

export function RecipeChipsMore({ column, hidden, items, renderChip }: RecipeChipsMoreProps) {
  const { open, hide, triggerProps, popupProps } = useHoverPopup<HTMLButtonElement>({ placement: 'below', mode: 'click' })
  const rateUnit = useUiStore(s => s.rateUnit)
  const empty = hidden.length === 0
  // A re-solve can empty the overflow while the dialog is open: close it, so it does not come back stale.
  useEffect(() => { if (empty) hide() }, [empty, hide])
  if (empty) return null
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
          // React events cross portals along the React tree: keep the row's context menu out of it. A chip that opened a
          // menu of its own (a byproduct's) closes the dialog, which would otherwise lie over the menu.
          onContextMenu={e => {
            e.stopPropagation()
            if (e.defaultPrevented) hide()
          }}
          // A press on a chip is an action (the chip's own handler ran first): the list has done its job.
          onClick={e => { if ((e.target as Element).closest('button[data-variant]')) hide() }}
          className="z-[60] w-max max-w-xs max-h-[270px] overflow-y-auto p-2 text-xs bg-gray-900 border border-gray-700 rounded-lg shadow-2xl"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-gray-400">{title}</span>
            <button type="button" onClick={hide} className="px-1.5 py-0.5 rounded border border-gray-700 text-gray-300 hover:text-gray-100">
              Close
            </button>
          </div>
          <ul className="flex flex-col gap-1">
            {hidden.map(entry => {
              const [itemId, ratePerMin] = entry
              return (
                <li key={itemId} className="flex items-center gap-2">
                  {renderChip(entry)}
                  <span className="truncate text-gray-200">{items[itemId]?.name ?? itemId}</span>
                  <span className="ml-auto pl-2 font-mono tabular-nums text-gray-400">{fmtItemRateText(itemId, ratePerMin / 60, rateUnit)}</span>
                </li>
              )
            })}
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}
