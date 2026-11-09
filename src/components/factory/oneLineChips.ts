import { useLayoutEffect, useRef, useState } from 'react'

/** One chip slot in a production-table cell: a 32px chip and the 6px gap (`gap-1.5`) after it. */
export const CHIP_SLOT_PX = 38
const CHIP_GAP_PX = CHIP_SLOT_PX - 32

/** How many chips fit on one line of a box `widthPx` wide (at least one); `null` for a box that has no width yet. */
export function chipsPerLine(widthPx: number): number | null {
  if (!(widthPx > 0)) return null
  return Math.max(1, Math.floor((widthPx + CHIP_GAP_PX) / CHIP_SLOT_PX))
}

/**
 * How many of `total` chips to draw in `lines` lines of `perLine` chips each, the rest sitting behind a "+N".
 * `cap` is the most chips ever drawn (what lies past it is behind the "+N" too, which takes a slot).
 * When everything fits, all show; otherwise one fewer than the lines hold, and the "+N" takes the last slot.
 * `perLine` of `null` (not measured: a box without layout) draws the capped chips.
 */
export function chipsInLines(total: number, perLine: number | null, lines: number, cap = Infinity): number {
  const wanted = Math.min(total, cap)
  if (perLine === null) return wanted
  const slots = perLine * lines
  const slotsNeeded = wanted + (total > wanted ? 1 : 0)
  return slotsNeeded <= slots ? wanted : Math.max(0, slots - 1)
}

/** `chipsInLines` for a single line: a collapsed area row is one line high. */
export function chipsOnOneLine(total: number, perLine: number | null, cap: number): number {
  return chipsInLines(total, perLine, 1, cap)
}

/**
 * The number of chips that fit on one line of the box `ref` points at, kept up to date as the box is resized;
 * `null` while the box has no width (before layout, in a DOM without layout). With `enabled` false nothing is measured
 * (no observer): for a box whose chips are not counted at the moment.
 */
export function useChipsPerLine<El extends HTMLElement>(enabled = true): { ref: React.RefObject<El | null>; perLine: number | null } {
  const ref = useRef<El>(null)
  const [perLine, setPerLine] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !enabled) return
    const measure = () => {
      const next = chipsPerLine(el.clientWidth)
      setPerLine(prev => (prev === next ? prev : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled])
  return { ref, perLine }
}
