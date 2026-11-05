import { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { useDismiss } from './sidePanel/useDismiss'
import { usePickerAnchor } from './pickerAnchor'

const MAX_HEIGHT = 288
const MARGIN = 8
const GAP = 4

/**
 * The frame of every picker: a popover list opened under its trigger. Rows are `PickerRow`s (icon, name, an optional detail
 * such as a machine's speed); an optional heading names what the choice does. It closes on a press outside the picker and
 * its trigger and on Esc (the topmost open picker only; nothing else reacts to that key).
 *
 * Render it inside a `PickerTrigger`, which provides the anchor. The popover is portalled to `document.body` and fixed
 * to the viewport: it lines up with the trigger's left edge, opens upward when there is more room above, and is clamped
 * to the viewport, so a table's scroll container never clips it.
 */
export function Picker({ heading, onClose, children, className = '', style, ...rest }: {
  heading?: ReactNode
  onClose: () => void
  children: ReactNode
  className?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  const anchor = usePickerAnchor()
  const self = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  useDismiss(anchor ? [self, anchor] : self, true, onClose)

  useLayoutEffect(() => {
    function place() {
      const el = self.current
      const trigger = anchor?.current
      if (!el || !trigger) return
      const r = trigger.getBoundingClientRect()
      const vw = document.documentElement.clientWidth
      const vh = document.documentElement.clientHeight
      const width = el.offsetWidth
      const natural = Math.min(el.scrollHeight + 2, MAX_HEIGHT)
      const below = vh - r.bottom - GAP - MARGIN
      const above = r.top - GAP - MARGIN
      const up = natural > below && above > below
      const left = Math.max(MARGIN, Math.min(r.left, vw - width - MARGIN))
      const maxHeight = Math.max(80, Math.min(MAX_HEIGHT, up ? above : below))
      setPos(up
        ? { left, bottom: vh - r.top + GAP, maxHeight }
        : { left, top: r.bottom + GAP, maxHeight })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])

  return createPortal(
    <div
      ref={self}
      data-testid="picker"
      // A click inside is the picker's own: it must not select the table row underneath (React events cross the portal).
      onClick={e => e.stopPropagation()}
      style={{ position: 'fixed', ...(pos ?? { top: 0, left: 0, visibility: 'hidden' }), ...style }}
      className={`z-50 w-60 max-h-72 overflow-y-auto bg-gray-800 border border-gray-600 rounded shadow-lg p-1 space-y-0.5 text-left ${className}`}
      {...rest}
    >
      {heading && <div data-testid="picker-heading" className="text-[10px] uppercase tracking-wide text-gray-500 px-2 pt-0.5 pb-1">{heading}</div>}
      {children}
    </div>,
    document.body,
  )
}

/** One row of a picker: an icon, a name and an optional trailing detail. */
export function PickerRow({ name, iconPath, detail, selected = false, onClick, className = '', ...rest }: {
  name: ReactNode
  iconPath?: string
  detail?: ReactNode
  selected?: boolean
  onClick: () => void
  className?: string
} & Omit<HTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 flex items-center gap-1.5 ${selected ? 'text-teal-400' : 'text-gray-300'} ${className}`}
      {...rest}
    >
      {iconPath && <Icon iconPath={iconPath} alt="" className="w-6 h-6 object-contain shrink-0" />}
      <span className="flex-1 min-w-0 truncate">{name}</span>
      {detail !== undefined && detail !== null && <span className="text-gray-500 tabular-nums shrink-0">{detail}</span>}
    </button>
  )
}

/** The note a picker shows when nothing fits. */
export function PickerEmpty({ children, ...rest }: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return <div className="px-2 py-1 text-xs text-gray-500 italic" {...rest}>{children}</div>
}
