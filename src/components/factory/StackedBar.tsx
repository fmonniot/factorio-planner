import { useLayoutEffect, useRef, useState } from 'react'
import { lookStyle } from './segmentLooks'
import type { SegmentLook } from './segmentLooks'
import { barAccessibleName, layoutBar } from './summarySegments'

// ---------------------------------------------------------------------------
// StackedBar — one bar of segments sized by weight, shared by the detail strip
// (an item's allocation) and the overview (a pane's segment keys). The bar writes
// the text it can fit; the black tooltip on hover or focus of a segment always
// carries the whole of it, and the segment's accessible name says the same.
// ---------------------------------------------------------------------------

export interface BarSegment {
  key: string
  look: SegmentLook
  /** Share of the bar. */
  weight: number
  /** A mark of fixed width that takes no share (an overlay on a bar that has real segments). */
  fixedPx?: number
  /** Name written in the bar. */
  name: string
  /** Amount written in the bar. */
  amount?: string
  /** The amount with the item count riding along ("381 · 14"), written instead when it fits. */
  withCount?: string
  /** Name, amount and note of the tooltip and of the accessible name. */
  tipName: string
  tipAmount?: string
  note?: string
  /** A second, muted line of the tooltip: what a click or a right-click does, why a source is limited. */
  detail?: string
  /** Overview segments are toggles; true while this one is the trace. */
  pressed?: boolean
  faded?: boolean
  dataKind?: string
  limited?: boolean
  testId: string
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}

/** Width of an element, kept up to date; 0 until measured (and where there is no layout at all). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(prev => (prev === el.clientWidth ? prev : el.clientWidth))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

interface StackedBarProps {
  segments: BarSegment[]
  /** Position of a marker across the bar (0..1), e.g. where a product's requirement falls. */
  tickAt?: number | null
  /** Accessible name of the bar as a group. */
  label?: string
}

export function StackedBar({ segments, tickAt = null, label }: StackedBarProps) {
  const { ref, width } = useWidth<HTMLDivElement>()
  const measured = width > 0
  const layout = measured
    ? layoutBar(segments.map(s => ({ weight: s.weight, fixedPx: s.fixedPx, amount: s.amount, withCount: s.withCount })), width)
    : null
  const total = segments.reduce((sum, s) => sum + (s.fixedPx === undefined ? Math.max(0, s.weight) : 0), 0)

  return (
    <div ref={ref} role="group" aria-label={label} className="relative flex w-full h-4 gap-px">
      {segments.map((s, i) => {
        const part = layout?.[i]
        // Before the first measure (and without layout) the bar is plain proportions with no text.
        const sizing: React.CSSProperties = part
          ? { width: part.px }
          : s.fixedPx !== undefined
            ? { width: s.fixedPx }
            : { flex: `0 1 ${total > 0 ? (Math.max(0, s.weight) / total) * 100 : 100 / segments.length}%` }
        const edge = part && part.center < 120 ? 'left-0' : part && part.center > width - 120 ? 'right-0' : 'left-1/2 -translate-x-1/2'
        const name = barAccessibleName(s.tipName, s.tipAmount, s.note)
        const common = {
          'data-testid': s.testId,
          'data-kind': s.dataKind,
          'data-key': s.key,
          'data-limited': s.limited ? 'true' : undefined,
          'aria-label': name,
          style: {
            ...sizing,
            ...lookStyle(s.pressed ? { ...s.look, border: '#f3f4f6' } : s.look),
            color: s.look.text,
            opacity: s.faded ? 0.5 : undefined,
          },
          className: `group relative shrink-0 min-w-0 h-full rounded-[3px] flex items-center gap-1.5 text-[10px] leading-[1.15] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${part && part.px < 24 ? 'px-0' : 'px-1'} ${s.onClick ? 'cursor-pointer' : 'cursor-default'}`,
        }
        const body = (
          <>
            {part?.name && <span className="min-w-0 flex-1 truncate text-left">{s.name}</span>}
            {part?.amount !== undefined && (
              <span className="shrink-0 font-mono font-bold">{part.amount}</span>
            )}
            <span
              aria-hidden="true"
              className={`hidden group-hover:flex group-focus-visible:flex flex-col gap-0.5 absolute z-50 bottom-[calc(100%+6px)] ${edge} bg-black text-gray-100 text-[11px] leading-normal font-normal text-left border border-gray-700 rounded px-2 py-1 pointer-events-none shadow-lg shadow-black/60`}
            >
              <span data-testid="summary-segment-tip" className="flex items-center gap-2 whitespace-nowrap">
                <span>{s.tipName}</span>
                {s.tipAmount !== undefined && <>{' '}<span className="font-mono font-bold">{s.tipAmount}</span></>}
                {s.note !== undefined && <>{' '}<span className="text-gray-400">{s.note}</span></>}
              </span>
              {s.detail !== undefined && (
                <span data-testid="summary-segment-detail" className="w-max max-w-[260px] whitespace-normal text-gray-400">{s.detail}</span>
              )}
            </span>
          </>
        )
        if (s.pressed !== undefined) {
          return (
            <button key={i} type="button" {...common} aria-pressed={s.pressed} onClick={s.onClick} onContextMenu={s.onContextMenu}>
              {body}
            </button>
          )
        }
        if (s.onClick) {
          return (
            <button key={i} type="button" {...common} onClick={s.onClick} onContextMenu={s.onContextMenu}>
              {body}
            </button>
          )
        }
        return (
          // Focusable so the tooltip opens from the keyboard and on a tap, like the buttons.
          <div key={i} role="img" tabIndex={0} {...common} onContextMenu={s.onContextMenu}>
            {body}
          </div>
        )
      })}
      {tickAt !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-0.5 -ml-px bg-gray-200"
          style={{ left: `${tickAt * 100}%` }}
        />
      )}
    </div>
  )
}
