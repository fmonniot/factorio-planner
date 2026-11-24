import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useUiStore } from '../../store/uiStore'
import { ComesFrom } from './ComesFrom'
import { useDismiss } from './sidePanel/useDismiss'
import { keepTabInside } from './keepTabInside'
import { liveAnchor } from './popoverAnchor'

// ---------------------------------------------------------------------------
// ComesFromPopover — the Comes from control of any item of the active block, in a popover opened where the player
// already is: the side panel's Change…, or the right-click menu of an ingredient chip. An item that has an Ingredients slot
// has the same control in the slot's strip; one that is only an intermediate of the block has no slot, and this is where
// its rule is set. The popover says whose rule it is (the block's, for every row; in a block with areas, the block's or one area's) and, when the item has a slot, links to it.
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
  const activeBlock = useBlockStore(selectActiveBlock)
  const activeBlockId = activeBlock?.id
  const gameData = useGameDataStore(selectGameData)
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  // Where the focus was when the popover opened, to give it back on Escape.
  const origin = useRef<HTMLElement | null>(null)

  // Escape gives the focus back to what had it. Opened from a menu entry, that element is gone with the menu: the anchor
  // (the chip, when it is a button) takes it then.
  const returnFocus = () => {
    const target = origin.current?.isConnected && origin.current !== document.body ? origin.current : popover?.anchor.el
    if (target instanceof HTMLElement && target.isConnected) target.focus()
  }

  // The rule is the active block's: another block, another popover.
  useEffect(() => { close() }, [activeBlockId, close])

  const shown = popover !== null && gameData !== undefined
  // Escape, or a press outside. A connection menu opened from the popover is outside it, and closes first: a press on it
  // or beside it belongs to the menu (it registered after this one, so it has not closed yet when this runs).
  useDismiss(ref, shown, () => {
    if (useUiStore.getState().connectionMenu) return
    close()
    returnFocus()
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
    // The control grows or shrinks with the chosen rule: keep the popover inside the window when it does.
    const observer = typeof ResizeObserver === 'undefined' || !ref.current ? undefined : new ResizeObserver(place)
    if (ref.current) observer?.observe(ref.current)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      observer?.disconnect()
    }
  }, [shown, anchor])

  // Focus goes to the chosen preset of the control when the popover opens (a new item gets it again).
  const itemId = popover?.itemId
  useLayoutEffect(() => {
    if (!shown) return
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // The list view has no radio: the header's Sources toggle, which comes before the radios in the DOM, takes it then.
    const el = ref.current
    ;(el?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ?? el?.querySelector<HTMLElement>('[data-testid="sources-button"]'))?.focus()
  }, [shown, itemId])

  if (!popover || !gameData) return null

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
      <ComesFrom
        key={`${popover.itemId}:${popover.seq ?? 0}`}
        itemId={popover.itemId}
        areaId={popover.areaId}
        initialListOpen={popover.list}
        heading={{ titleId, onClose: () => { close(); returnFocus() } }}
      />
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
