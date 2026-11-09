import type { HTMLAttributes, ReactNode } from 'react'
import { Icon } from '../Icon'

// ---------------------------------------------------------------------------
// IconChip — the one component for every icon-with-a-number in the production table:
// the icon, a quantity in the bottom-right corner (as Factorio draws stack counts) and
// optional badges in the top-right corner.
// ---------------------------------------------------------------------------

export type ChipTone = 'neutral' | 'product' | 'byproduct' | 'ingredient'

const QUANTITY_COLOR: Record<ChipTone, string> = {
  neutral: 'text-white',
  product: 'text-gray-200 font-bold',
  byproduct: 'text-red-300',
  ingredient: 'text-green-300',
}

interface IconChipProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** The icon; without one the `fallback` (or the first letters of `alt`) is drawn. */
  iconPath?: string
  alt: string
  fallback?: ReactNode
  /** 'item' is 28px (item icons), 'entity' 32px (machines, modules, beacons). */
  size?: 'item' | 'entity'
  /** Bottom-right corner. */
  quantity?: ReactNode
  tone?: ChipTone
  /** Top-right corner: pin, `+N`, `B` / `C`. */
  badges?: ReactNode
  /** An empty slot: dashed outline and a `+` instead of an icon. */
  empty?: boolean
  /** Amber ring: outside the research horizon, more modules than slots… */
  warn?: boolean
  /** Small label in the top-left corner (a temperature requirement). */
  corner?: ReactNode
  /** Makes the chip a button. */
  onClick?: () => void
  /** With `onClick`: the button is disabled. */
  disabled?: boolean
  quantityTestId?: string
}

export function IconChip({
  iconPath, alt, fallback, size = 'item', quantity, tone = 'neutral', badges, empty = false, warn = false,
  corner, onClick, disabled, quantityTestId, className = '', ...rest
}: IconChipProps) {
  const box = size === 'entity' ? 'w-8 h-8' : 'w-7 h-7'
  const ring = warn ? 'ring-1 ring-amber-500' : ''
  const body = (
    <>
      {empty ? (
        <span className={`${box} box-border rounded border border-dashed border-gray-600 text-gray-400 flex items-center justify-center text-sm leading-none`}>
          +
        </span>
      ) : iconPath ? (
        <Icon iconPath={iconPath} alt={alt} className={`${box} object-contain shrink-0`} />
      ) : (
        <span className={`${box} bg-gray-700 rounded text-[9px] text-gray-300 flex items-center justify-center leading-none select-none overflow-hidden`}>
          {fallback ?? alt.substring(0, 2).toUpperCase()}
        </span>
      )}
      {corner && (
        <span className="absolute left-0 top-0 text-[8px] leading-none font-mono text-orange-300" style={OUTLINE}>
          {corner}
        </span>
      )}
      {quantity !== undefined && quantity !== null && (
        <span
          data-testid={quantityTestId}
          data-chip-quantity=""
          className={`absolute right-0 bottom-0 text-[9px] font-mono font-bold leading-none px-px tabular-nums ${empty ? 'text-gray-400' : QUANTITY_COLOR[tone]}`}
          style={OUTLINE}
        >
          {quantity}
        </span>
      )}
      {badges && <span className="absolute -top-1 -right-1 flex gap-px z-[1]">{badges}</span>}
    </>
  )
  const base = `relative inline-flex shrink-0 rounded ${ring} ${className}`
  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${disabled ? '' : 'hover:ring-1 hover:ring-gray-500 cursor-pointer'}`} {...rest}>
        {body}
      </button>
    )
  }
  return <span className={base} {...rest}>{body}</span>
}

const OUTLINE = { textShadow: '0 0 2px #000, 0 0 2px #000, 0 0 3px #000' }

// Badges ---------------------------------------------------------------------

/** Amber pin: the product's rate is pinned. */
export function PinBadge() {
  return (
    <span
      role="img"
      aria-label="Rate pinned"
      title="Rate pinned"
      data-testid="chip-pin"
      className="w-3.5 h-3.5 box-border rounded-full bg-amber-300 border border-gray-900 flex items-center justify-center"
    >
      <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M4 1h4l-.6 4 2 2H2.6l2-2zM6 7v4" fill="#422006" stroke="#422006" strokeWidth="1.2" />
      </svg>
    </span>
  )
}

/** Amber `B` or `C`: the item is not sourced from Own recipes first. */
export function SourcingBadge({ letter, mode }: { letter: 'B' | 'C'; mode: string }) {
  return (
    <span
      data-testid="item-tile-sourcing"
      data-sourcing={mode}
      aria-hidden
      className="w-3.5 h-3.5 box-border rounded-full bg-amber-300 text-amber-950 border border-gray-900 text-[9px] font-bold leading-[12px] text-center"
    >
      {letter}
    </span>
  )
}

/** Lavender `+N`: the row has N more beacon configurations. */
export function MoreBadge({ count }: { count: number }) {
  return (
    <span
      role="img"
      aria-label={`${count} more beacon configuration${count === 1 ? '' : 's'}`}
      data-testid="chip-more"
      className="min-w-4 h-4 box-border px-[3px] rounded-lg bg-purple-300 text-purple-950 border border-gray-900 text-[9px] font-bold leading-[14px] text-center"
    >
      +{count}
    </span>
  )
}
