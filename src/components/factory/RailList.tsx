import type { ReactNode } from 'react'
import { DashedSquareIcon } from './SourcesLine'
import { StripIcon } from './StripIcon'

/**
 * What a line stands for, which picks its icon: a row of this block, rows of another area, a block (a swatch in the colour the
 * caller resolved), a product of the block, what is left over, an import, or what is missing.
 */
export type RailTarget =
  | { kind: 'row' }
  | { kind: 'area' }
  | { kind: 'block'; color: string }
  | { kind: 'product' }
  | { kind: 'left' }
  | { kind: 'import' }
  | { kind: 'missing' }

/** A dashed down arrow: nothing arrives. Deliberately not the strip's Import off icon. */
function MissingIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 .9v9.6M3.5 8L6 10.5 8.5 8" />
    </svg>
  )
}

const TONES: Record<RailTarget['kind'], string> = {
  row: 'text-teal-300',
  area: 'text-gray-300',
  block: '',
  import: 'text-gray-300',
  product: 'text-green-300',
  left: 'text-gray-400',
  missing: 'text-amber-300',
}

function TargetIcon({ target }: { target: RailTarget }) {
  switch (target.kind) {
    case 'row': return <StripIcon name="make" />
    case 'area': return <DashedSquareIcon />
    case 'block': return <span data-testid="rail-block-color" className="inline-block size-2.5 rounded-sm" style={{ background: target.color }} />
    case 'product': return <StripIcon name="block-product" />
    case 'left': return <StripIcon name="leftover" />
    case 'import': return <StripIcon name="import" />
    case 'missing': return <MissingIcon />
  }
}

/**
 * A list of lines hung on a vertical rail, with a dot where the rail starts or an arrow where it ends: `head` for what leaves the
 * item (a dot opens the list: the item starts there and goes to the lines), `foot` for what comes into it (a down chevron closes
 * the list: the lines run into the item). The dot and the chevron are the Served order… and Sources… icons' own: the dot is
 * where a flow starts, the chevron where it arrives. Generic: it knows nothing about what the lines say.
 *
 * The rail, the icon cells, the dot and the chevron share one 14px column, all in one grey. The list starts 7px in so that
 * column is centred under the header's 28px item icon; `className` takes the inset on the right, which is the width of the
 * header's trailing element plus the 8px gap (`mr-8` for a 24px button, `mr-14` for a 48px tag), so the lines' rates end where
 * the header's rate does (a line's `unit` makes its digits end where the header's digits do).
 */
export function RailList({ arrow, label, testId, className = '', children }: {
  arrow: 'head' | 'foot'
  /** The accessible name of the list. */
  label: string
  testId?: string
  className?: string
  children: ReactNode
}) {
  const head = arrow === 'head'
  // A 4px dot, its centre (y 3 of 6) on the rail's start. Drawn above the rail.
  const dotRow = (
    <li aria-hidden="true" data-testid="rail-dot" className="relative z-[2] flex h-1.5 w-3.5 items-start justify-center">
      <span className="mt-px size-1 rounded-full bg-gray-500" />
    </li>
  )
  // A chevron pointing down; its vertex (y 4.25 of 6) is the rail's end. Drawn above the rail, so the rail's end tucks under
  // the vertex.
  const arrowRow = (
    <li aria-hidden="true" data-testid="rail-arrow" className="relative z-[2] flex h-1.5 w-3.5 justify-center text-gray-500">
      <svg width="10" height="5" viewBox="0 0 10 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1.5 .75L5 4.25 8.5 .75" />
      </svg>
    </li>
  )
  return (
    <ul aria-label={label} data-testid={testId} data-arrow={arrow} className={`relative my-1 ml-[7px] ${className}`}>
      <li
        aria-hidden="true"
        role="presentation"
        data-testid="rail-stem"
        className={`absolute left-1.5 z-[1] w-0.5 bg-gray-500 ${head ? 'top-[3px] bottom-2.5' : 'top-2.5 bottom-0.5'}`}
      />
      {head && dotRow}
      {children}
      {!head && arrowRow}
    </ul>
  )
}

/** One line of a `RailList`: an icon on the rail, a label with an optional detail, and a right-aligned rate. */
export function RailLine({ target, label, tag, detail, rate, unit, tip, tone, testId = 'rail-line', labelTestId = 'rail-line-label', rateTestId = 'rail-line-rate', attrs }: {
  target: RailTarget
  label: ReactNode
  /** A small chip after the label that never truncates with it. */
  tag?: ReactNode
  /** Secondary text after the label, greyed. */
  detail?: ReactNode
  rate: ReactNode
  /**
   * The unit the header's rate ends with, drawn invisibly after the rate (generated content, so not part of the rate's text): the
   * rate's digits then end where the header's digits do. Left out when the rate carries its unit itself (electricity, heat).
   */
  unit?: string
  /** The instant tooltip of the line. */
  tip: string
  /** `warn` draws the line and its rate amber. */
  tone?: 'warn'
  testId?: string
  labelTestId?: string
  rateTestId?: string
  /** Extra attributes on the line, such as `data-kind`. */
  attrs?: Record<string, string | undefined>
}) {
  const warn = tone === 'warn'
  return (
    <li
      data-testid={testId}
      data-tip={tip}
      data-target={target.kind}
      {...attrs}
      className={`group relative flex h-5 items-center gap-1.5 rounded text-[11px] ${warn ? 'text-amber-300' : 'text-gray-300'} hover:bg-[#1a2333]`}
    >
      {/* The mask hides the rail 1px around the icon, whatever the icon's size, so every icon keeps the same gap to the rail. */}
      <span aria-hidden="true" data-icon={target.kind} className={`relative z-10 flex h-3.5 w-3.5 shrink-0 items-center justify-center ${TONES[target.kind]}`}>
        <span data-testid="rail-icon-mask" className="flex bg-gray-900 p-px group-hover:bg-[#1a2333]">
          <TargetIcon target={target} />
        </span>
      </span>
      {/* The label and the rate share a baseline: centred, the mono rate would sit a pixel above the sans label. */}
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="flex min-w-0 flex-1 items-center">
          <span data-testid={labelTestId} className="truncate">{label}</span>
          {tag}
          {detail !== undefined && <span className="ml-1.5 truncate text-gray-400">{detail}</span>}
        </span>
        <span
          data-testid={rateTestId}
          data-unit={unit}
          className={`min-w-11 shrink-0 text-right font-mono tabular-nums ${warn ? 'text-amber-300' : 'text-gray-200'} ${unit ? 'after:invisible after:font-sans after:content-[attr(data-unit)]' : ''}`}
        >
          {rate}
        </span>
      </span>
    </li>
  )
}
