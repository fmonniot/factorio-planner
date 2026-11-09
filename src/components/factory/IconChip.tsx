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
  /**
   * 'item' (item icons in the table) and 'entity' (machines, modules, beacons) are both 32px. An item chip sits on a faint
   * plate and draws its quantity at 11px; an entity chip has no plate and a 9px quantity.
   */
  size?: 'item' | 'entity'
  /** Bottom-right corner. */
  quantity?: ReactNode
  tone?: ChipTone
  /** Top-right corner: pin, `+N`, `B` / `C`. */
  badges?: ReactNode
  /** An empty slot: dashed outline and a `+` instead of an icon. */
  empty?: boolean
  /**
   * With `empty`, in a table row: fainter at rest, back to the usual tone while the row is hovered, selected or holds the keyboard
   * focus (the row is a `group/row`), and brighter on the placeholder itself. Never hidden, so touch screens look the same.
   */
  quiet?: boolean
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
  iconPath, alt, fallback, size = 'item', quantity, tone = 'neutral', badges, empty = false, quiet = false, warn = false,
  corner, onClick, disabled, quantityTestId, className = '', ...rest
}: IconChipProps) {
  const item = size === 'item'
  const quietEmpty = empty && quiet
  const locked = !!onClick && !!disabled
  const box = 'w-8 h-8'
  const ring = warn ? 'ring-1 ring-amber-500' : ''
  const body = (
    <>
      {empty ? (
        <span className={`${box} box-border rounded border border-dashed ${quietEmpty ? quietBorder(!locked) : 'border-gray-600 text-gray-400'} flex items-center justify-center text-sm leading-none`}>
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
          className={`absolute right-0 bottom-0 ${item ? 'text-[11px]' : 'text-[9px]'} font-mono font-bold leading-none px-px tabular-nums ${empty ? (quietEmpty ? '' : 'text-gray-400') : QUANTITY_COLOR[tone]}`}
          style={item ? OUTLINE_4 : OUTLINE}
        >
          {quantity}
        </span>
      )}
      {badges && <span className="absolute -top-1 -right-1 flex gap-px z-[1]">{badges}</span>}
    </>
  )
  const plate = item ? 'rounded-[5px] bg-[rgba(148,163,184,0.09)] shadow-[inset_0_0_0_1px_rgba(148,163,184,0.10)]' : 'rounded'
  const base = `relative inline-flex shrink-0 group/chip ${plate} ${ring} ${quietEmpty ? quietText(!locked) : ''} ${className}`
  if (onClick) {
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${disabled ? '' : 'hover:ring-1 hover:ring-gray-500 cursor-pointer'}`} {...rest}>
        {body}
      </button>
    )
  }
  return <span className={base} {...rest}>{body}</span>
}

// A quiet placeholder: gray-700 border and gray-600 glyph at rest, gray-600 and gray-400 on the row's hover / selection / focus,
// gray-400 and gray-200 on the placeholder itself (`!`: it wins over the row's rule whatever the order of the generated CSS). The glyph
// colour sits on the chip so the `+` and the `0/2` share it. A disabled placeholder takes the row's tone but never brightens itself:
// it is not an invitation to click.
const quietBorder = (interactive: boolean) =>
  'border-gray-700 group-hover/row:border-gray-600 group-focus-within/row:border-gray-600 group-data-[selected=true]/row:border-gray-600' +
  (interactive ? ' group-hover/chip:border-gray-400! group-focus-visible/chip:border-gray-400!' : '')
const quietText = (interactive: boolean) =>
  'text-gray-600 group-hover/row:text-gray-400 group-focus-within/row:text-gray-400 group-data-[selected=true]/row:text-gray-400' +
  (interactive ? ' hover:text-gray-200! focus-visible:text-gray-200!' : '')

const OUTLINE = { textShadow: '0 0 2px #000, 0 0 2px #000, 0 0 3px #000' }
/** A 1px black outline in four directions: the item quantity at 11px stays readable on any icon. */
const OUTLINE_4 = { textShadow: '-1px 0 #000, 1px 0 #000, 0 -1px #000, 0 1px #000' }

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
