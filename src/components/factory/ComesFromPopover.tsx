import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useUiStore } from '../../store/uiStore'
import { Icon } from '../Icon'
import { ComesFrom } from './ComesFrom'
import { useDismiss } from './sidePanel/useDismiss'
import { keepTabInside } from './keepTabInside'
import { liveAnchor } from './popoverAnchor'

// ---------------------------------------------------------------------------
// ComesFromPopover — the Comes from control of any item of the active block, in a popover opened where the player
// already is: the side panel's Change…, or the right-click menu of an ingredient chip. An item that has an Ingredients slot
// has the same control in the slot's strip; one that is only an intermediate of the block has no slot, and this is where
// its rule is set. The popover says whose rule it is (the block's, for every row) and, when the item has a slot, links to it.
// ---------------------------------------------------------------------------

const MARGIN = 8
const GAP = 6

export function ComesFromPopover({ hasSlot }: {
  /** Whether the item has an Ingredients slot in the active block (it is imported, connected or locked). */
  hasSlot: (itemId: string) => boolean
}) {
  const popover = useUiStore(s => s.comesFromPopover)
  const close = useUiStore(s => s.closeComesFrom)
  const openIngredientSlot = useUiStore(s => s.openIngredientSlot)
  const activeBlockId = useBlockStore(selectActiveBlock)?.id
  const gameData = useGameDataStore(selectGameData)
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  // Where the focus was when the popover opened, to give it back on Escape.
  const origin = useRef<HTMLElement | null>(null)

  // The rule is the active block's: another block, another popover.
  useEffect(() => { close() }, [activeBlockId, close])

  const shown = popover !== null && gameData !== undefined
  // Escape, or a press outside. A connection menu opened from the popover is outside it, and closes first: a press on it
  // or beside it belongs to the menu (it registered after this one, so it has not closed yet when this runs).
  useDismiss(ref, shown, () => {
    if (useUiStore.getState().connectionMenu) return
    close()
    if (origin.current?.isConnected) origin.current.focus()
  })

  // Beside the side panel when it opened from there, else under its anchor; flipped and clamped to stay in the window. It
  // follows its anchor while the page or the panel scrolls.
  const anchor = popover?.anchor
  useLayoutEffect(() => {
    if (!shown || !anchor) return
    function place() {
      const el = ref.current
      if (!el || !anchor) return
      const w = el.offsetWidth
      const h = el.offsetHeight
      const vw = document.documentElement.clientWidth
      const vh = document.documentElement.clientHeight
      const { rect, avoid } = liveAnchor(anchor)
      let left: number
      let top: number
      if (avoid && avoid.left - w - GAP >= MARGIN) {
        left = avoid.left - w - GAP
        top = rect.top - MARGIN
      } else {
        left = rect.left
        top = rect.bottom + GAP
        if (left + w > vw - MARGIN) left = rect.right - w
        if (top + h > vh - MARGIN) top = rect.top - h - GAP
      }
      el.style.left = `${Math.max(MARGIN, Math.min(left, vw - w - MARGIN))}px`
      el.style.top = `${Math.max(MARGIN, Math.min(top, vh - h - MARGIN))}px`
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [shown, anchor])

  // Focus goes to the chosen preset of the control when the popover opens (a new item gets it again).
  const itemId = popover?.itemId
  useLayoutEffect(() => {
    if (!shown) return
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus()
  }, [shown, itemId])

  if (!popover || !gameData) return null
  const item = gameData.items[popover.itemId]
  const name = item?.name ?? popover.itemId

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      data-testid="comes-from-popover"
      data-item-id={popover.itemId}
      onKeyDown={keepTabInside}
      style={{ position: 'fixed', top: 0, left: 0 }}
      className="z-50 flex w-[340px] max-w-[calc(100vw-1rem)] flex-col gap-2 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl px-3 py-2.5 text-left"
    >
      <div className="flex items-center gap-2">
        {item?.iconPath && <Icon iconPath={item.iconPath} alt="" className="w-6 h-6 object-contain shrink-0" />}
        <div className="min-w-0 flex-1 leading-tight">
          <div id={titleId} className="text-xs font-semibold text-gray-100 truncate">{name}</div>
          <div className="text-[11px] text-gray-400">Applies to every row of this block</div>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => { close(); if (origin.current?.isConnected) origin.current.focus() }}
          className="shrink-0 inline-flex text-gray-400 hover:text-gray-100 pl-1 outline-none focus-visible:ring-2 focus-visible:ring-teal-400 rounded"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <ComesFrom itemId={popover.itemId} />
      {hasSlot(popover.itemId) && (
        <button
          type="button"
          data-testid="comes-from-show-slot"
          onClick={() => {
            const id = popover.itemId
            close()
            // No focus return here: the Ingredients pane takes the focus for the slot's Comes from control.
            openIngredientSlot(id)
          }}
          className="self-start text-[11px] text-teal-300 underline underline-offset-2 outline-none hover:text-teal-200 focus-visible:ring-2 focus-visible:ring-teal-400 rounded"
        >
          Show in Ingredients
        </button>
      )}
    </div>,
    document.body,
  )
}
