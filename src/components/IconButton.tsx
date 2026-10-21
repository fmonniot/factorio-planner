import type { ReactNode, Ref } from 'react'

interface IconButtonProps {
  /** Accessible name; also the tooltip text. */
  label: string
  onClick: () => void
  /** The icon. */
  children: ReactNode
  expanded?: boolean
  hasPopup?: 'dialog' | 'menu'
  /** Suppress the tooltip, e.g. while the button's popover is open. */
  hideTooltip?: boolean
  buttonRef?: Ref<HTMLButtonElement>
  /** Rendered next to the button, positioned against its wrapper (a dot, a popover). */
  extra?: ReactNode
  /** Wider button for a short text label: `h-8 px-2 gap-1 text-xs` in place of the 32px square. */
  wide?: boolean
}

/**
 * A borderless 32px icon button with a CSS-only tooltip. The wrapper is
 * `relative` so `extra` can be anchored to it.
 */
export function IconButton({ label, onClick, children, expanded, hasPopup, hideTooltip, buttonRef, extra, wide }: IconButtonProps) {
  return (
    <span className="relative group">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={expanded}
        aria-haspopup={hasPopup}
        onClick={onClick}
        className={`relative ${wide ? 'h-8 px-2 gap-1 text-xs' : 'w-8 h-8'} rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-800 hover:text-gray-100 focus-visible:bg-gray-800 focus-visible:text-gray-100 outline-none`}
      >
        {children}
      </button>
      {!hideTooltip && (
        <span
          aria-hidden
          className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 hidden group-hover:block group-has-focus-visible:block bg-black text-gray-100 text-xs border border-gray-700 rounded px-2 py-1 whitespace-nowrap pointer-events-none"
        >
          {label}
        </span>
      )}
      {extra}
    </span>
  )
}
