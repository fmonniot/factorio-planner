import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Block, GameData, ServedList } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { fmtItemRateText } from './ItemTile'
import { useDismiss } from './sidePanel/useDismiss'
import { hasServedOrder, servedLines } from './servedOrder'

// ---------------------------------------------------------------------------
// ServedOrderPopover — read-only list of the order the solver served an item's consumers in, and where the
// source's own extra output came in. Opened from the Served order… action of a selected slot.
// ---------------------------------------------------------------------------

interface ServedOrderPopoverProps {
  itemId: string
  list: ServedList
  items: GameData['items']
  blocks: Block[]
  rateUnit: RateUnit
  /** Viewport coordinates of the button that opened it. */
  x: number
  y: number
  onClose: () => void
}

export function ServedOrderPopover({ itemId, list, items, blocks, rateUnit, x, y, onClose }: ServedOrderPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const origin = useRef<HTMLElement | null>(null)
  const [pos, setPos] = useState({ x, y })
  const itemName = items[itemId]?.name ?? itemId

  // Focus the dialog on open; Escape gives the focus back to what had it.
  useLayoutEffect(() => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ref.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.max(0, Math.min(x, window.innerWidth - width)),
      y: Math.max(0, Math.min(y, window.innerHeight - height)),
    })
  }, [x, y])

  useDismiss(ref, true, () => {
    onClose()
    const target = origin.current
    if (target?.isConnected && target !== document.body) target.focus()
  })

  // A fixed box would float away from its slot: close on scroll and resize.
  const onCloseRef = useRef(onClose)
  useLayoutEffect(() => { onCloseRef.current = onClose })
  useLayoutEffect(() => {
    const dismiss = () => onCloseRef.current()
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [])

  if (!hasServedOrder(list)) return null
  const amount = (perMin: number) => fmtItemRateText(itemId, perMin / 60, rateUnit)
  const lines = servedLines(list, itemId, rateUnit)

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`Served order of ${itemName}`}
      tabIndex={-1}
      data-testid="served-order-popover"
      data-item-id={itemId}
      style={{ position: 'fixed', left: pos.x, top: pos.y }}
      className="z-50 flex w-[320px] max-w-[calc(100vw-1rem)] flex-col gap-1.5 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl px-3 py-2.5 text-left outline-none"
      onContextMenu={e => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="text-xs font-semibold text-gray-100">Served in this order</div>
      <div className="text-[11px] text-gray-400">The order the solver served them in. The extra output comes last.</div>
      <ol className="flex flex-col gap-1 text-xs text-gray-300">
        {lines.map(line => {
          const block = line.blockId !== undefined ? blocks.find(b => b.id === line.blockId) : undefined
          const name = line.kind === 'extra' ? 'Extra output' : (block?.name ?? line.blockId)
          return (
            <li
              key={line.kind === 'extra' ? 'extra' : line.connectionId}
              data-testid="served-line"
              data-kind={line.kind}
              data-block-id={line.blockId}
              className="flex flex-wrap items-baseline gap-x-2"
            >
              <span className="font-mono tabular-nums text-gray-500">{line.rank}</span>
              {block && (
                <span aria-hidden="true" className="inline-block w-2 h-2 rounded-full self-center" style={{ backgroundColor: block.color }} />
              )}
              <span className="font-medium text-gray-100">{name}</span>
              {line.kind === 'take' ? (
                <>
                  <span className="text-gray-400">takes what is left</span>
                  <span className="font-mono tabular-nums">got {amount(line.got)}</span>
                </>
              ) : (
                <>
                  <span className="font-mono tabular-nums">asked {amount(line.asked ?? 0)}</span>
                  <span className="font-mono tabular-nums">got {amount(line.got)}</span>
                  {line.short !== undefined && (
                    <span data-testid="served-short" className="font-mono tabular-nums text-amber-300">short {amount(line.short)}</span>
                  )}
                </>
              )}
            </li>
          )
        })}
      </ol>
    </div>,
    document.body,
  )
}
