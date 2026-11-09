import type { ReactNode, Ref } from 'react'

/**
 * The black tooltip of the top-bar buttons: a box that sits below the element it is anchored to.
 * `TOOLTIP_CLASS` positions it against a `relative group` wrapper and shows it on hover and on
 * keyboard focus (`group-has-focus-visible`); it steps aside while a menu inside the wrapper is
 * open (`aria-expanded`). A tooltip that must escape a clipping container is a fixed element
 * that wears only `TOOLTIP_BOX_CLASS` (see the block tabs).
 */
export const TOOLTIP_BOX_CLASS = 'z-50 bg-black text-gray-100 text-xs border border-gray-700 rounded px-2 py-1 whitespace-nowrap pointer-events-none'
export const TOOLTIP_CLASS = `absolute top-full left-1/2 -translate-x-1/2 mt-1 hidden group-hover:block group-has-focus-visible:block group-has-[[aria-expanded=true]]:hidden ${TOOLTIP_BOX_CLASS}`

interface IconButtonProps {
  /** Accessible name; also the tooltip text. */
  label: string
  onClick: () => void
  /** The icon. */
  children: ReactNode
  /** `aria-expanded`; the tooltip steps aside while it is true. */
  expanded?: boolean
  hasPopup?: 'dialog' | 'menu'
  buttonRef?: Ref<HTMLButtonElement>
  /** Rendered next to the button, positioned against its wrapper (a dot, a popover). */
  extra?: ReactNode
  /** Wider button for a short text label: `h-8 px-2 gap-1 text-xs` in place of the 32px square. */
  wide?: boolean
  /** Text colour of the icon at rest. */
  iconClass?: string
  disabled?: boolean
}

/**
 * A borderless 32px icon button with a CSS-only tooltip. The wrapper is
 * `relative` so `extra` can be anchored to it.
 */
export function IconButton({ label, onClick, children, expanded, hasPopup, buttonRef, extra, wide, iconClass = 'text-gray-300', disabled }: IconButtonProps) {
  return (
    <span className="relative group">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={expanded}
        aria-haspopup={hasPopup}
        onClick={onClick}
        disabled={disabled}
        className={`relative ${wide ? 'h-8 px-2 gap-1 text-xs' : 'w-8 h-8'} rounded-md flex items-center justify-center ${iconClass} hover:bg-gray-800 hover:text-gray-100 focus-visible:bg-gray-800 focus-visible:text-gray-100 outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
      >
        {children}
      </button>
      <span aria-hidden className={TOOLTIP_CLASS}>
        {label}
      </span>
      {extra}
    </span>
  )
}
