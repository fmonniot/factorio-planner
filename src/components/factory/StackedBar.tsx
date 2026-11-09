import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { lookStyle } from './segmentLooks'
import type { SegmentLook } from './segmentLooks'
import { barAccessibleName, layoutBar, tipPlacement } from './summarySegments'

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
  const baseId = useId()
  const layout = measured
    ? layoutBar(segments.map(s => ({ weight: s.weight, fixedPx: s.fixedPx, amount: s.amount, withCount: s.withCount })), width)
    : null
  const total = segments.reduce((sum, s) => sum + (s.fixedPx === undefined ? Math.max(0, s.weight) : 0), 0)
  // On touch there is no hover: the first tap on a segment opens its tooltip (and does nothing else),
  // a second tap on the same segment does what a click does; a tap elsewhere or Escape closes it.
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const pointerType = useRef('')
  useEffect(() => {
    if (openIndex === null) return
    const onPointerDown = (e: PointerEvent) => {
      const hit = e.target instanceof Element ? e.target.closest('[data-seg-index]') : null
      if (!(hit && ref.current?.contains(hit) && hit.getAttribute('data-seg-index') === String(openIndex))) setOpenIndex(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpenIndex(null)
      // The tapped segment holds the focus, which shows the tooltip as soon as a key is pressed.
      if (ref.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openIndex, ref])
  const tapped = (i: number, action?: () => void) => (e: React.MouseEvent) => {
    if (pointerType.current === 'touch' && openIndex !== i) {
      e.preventDefault()
      setOpenIndex(i)
      return
    }
    setOpenIndex(null)
    action?.()
  }

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
        const place = part ? tipPlacement(part, width) : null
        const edge = !place ? 'left-1/2 -translate-x-1/2'
          : place.align === 'center' ? 'left-1/2 -translate-x-1/2'
            : place.align === 'left' ? 'left-0'
              : place.align === 'right' ? 'right-0'
                : ''
        const tipStyle: React.CSSProperties = {
          maxWidth: place?.maxWidth ?? 280,
          left: place?.align === 'shifted' ? place.left : undefined,
        }
        const name = barAccessibleName(s.tipName, s.tipAmount, s.note)
        const detailId = s.detail !== undefined ? `${baseId}-${i}-detail` : undefined
        const common = {
          'data-testid': s.testId,
          'data-kind': s.dataKind,
          'data-key': s.key,
          'data-limited': s.limited ? 'true' : undefined,
          'aria-label': name,
          // The second line of the tooltip is not in the name: it is the description.
          'aria-describedby': detailId,
          'data-seg-index': i,
          onPointerDown: (e: React.PointerEvent) => { pointerType.current = e.pointerType },
          onKeyDown: () => { pointerType.current = 'key' },
          style: { ...sizing, color: s.look.text },
          className: `group relative shrink-0 min-w-0 h-full rounded-[3px] border border-transparent flex items-center gap-1.5 text-[10px] leading-[1.15] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${part && part.px < 24 ? 'px-0' : 'px-1'} ${s.onClick ? 'cursor-pointer' : 'cursor-default'}`,
        }
        const body = (
          <>
            {/* The fill is its own layer so that fading a segment never fades its text or tooltip. */}
            <span
              aria-hidden="true"
              data-testid="summary-segment-fill"
              className="absolute inset-0 rounded-[3px] pointer-events-none"
              style={{ ...lookStyle(s.pressed ? { ...s.look, border: '#f3f4f6' } : s.look), opacity: s.faded ? 0.5 : undefined }}
            />
            {part?.name && <span className="relative min-w-0 flex-1 truncate text-left">{s.name}</span>}
            {part?.amount !== undefined && (
              <span className="relative shrink-0 font-mono font-bold">{part.amount}</span>
            )}
            <span
              aria-hidden="true"
              style={tipStyle}
              className={`${openIndex === i ? 'flex' : 'hidden group-hover:flex group-focus-visible:flex'} w-max whitespace-normal break-words flex-col gap-0.5 absolute z-50 bottom-[calc(100%+6px)] ${edge} bg-black text-gray-100 text-[11px] leading-normal font-normal text-left border border-gray-700 rounded px-2 py-1 pointer-events-none shadow-lg shadow-black/60`}
            >
              <span data-testid="summary-segment-tip" className="flex flex-wrap items-baseline gap-x-2">
                <span>{s.tipName}</span>
                {s.tipAmount !== undefined && <>{' '}<span className="font-mono font-bold">{s.tipAmount}</span></>}
                {s.note !== undefined && <>{' '}<span className="text-gray-400">{s.note}</span></>}
              </span>
              {s.detail !== undefined && (
                <span id={detailId} data-testid="summary-segment-detail" className="whitespace-normal text-gray-400">{s.detail}</span>
              )}
            </span>
          </>
        )
        if (s.pressed !== undefined) {
          return (
            <button key={i} type="button" {...common} aria-pressed={s.pressed} onClick={tapped(i, s.onClick)} onContextMenu={s.onContextMenu}>
              {body}
            </button>
          )
        }
        if (s.onClick) {
          return (
            <button key={i} type="button" {...common} onClick={tapped(i, s.onClick)} onContextMenu={s.onContextMenu}>
              {body}
            </button>
          )
        }
        return (
          // Focusable so the tooltip opens from the keyboard and on a tap, like the buttons.
          <div key={i} role="img" tabIndex={0} {...common} onClick={tapped(i)} onContextMenu={s.onContextMenu}>
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
