import { useMemo, useRef, type HTMLAttributes, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { useDismiss } from './sidePanel/useDismiss'

/**
 * The frame of every picker: a popover list opened under its trigger. Rows are `PickerRow`s (icon, name, an optional detail
 * such as a machine's speed); an optional heading names what the choice does. It closes on a press outside the trigger's
 * wrapper and on Esc (which nothing else reacts to).
 *
 * Render it as a sibling of the trigger inside a `relative` wrapper: that wrapper is the picker's anchor and the area whose
 * presses do not count as "outside" (so a press on the trigger just toggles).
 */
export function Picker({ heading, onClose, align = 'left', children, className = '', ...rest }: {
  heading?: ReactNode
  onClose: () => void
  /** Which edge of the trigger the picker lines up with. */
  align?: 'left' | 'right'
  children: ReactNode
  className?: string
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  const self = useRef<HTMLDivElement>(null)
  // The wrapper the picker sits in (trigger included) is the dismissal root.
  const anchor = useMemo(() => ({ get current() { return self.current?.parentElement ?? null } }), [])
  useDismiss(anchor, true, onClose)
  return (
    <div
      ref={self}
      data-testid="picker"
      // A click inside is the picker's own: it must not select the table row underneath.
      onClick={e => e.stopPropagation()}
      className={`absolute z-50 top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} w-60 max-h-72 overflow-y-auto bg-gray-800 border border-gray-600 rounded shadow-lg p-1 space-y-0.5 text-left ${className}`}
      {...rest}
    >
      {heading && <div data-testid="picker-heading" className="text-[10px] uppercase tracking-wide text-gray-500 px-2 pt-0.5 pb-1">{heading}</div>}
      {children}
    </div>
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
