// Arithmetic of the collapsed summary's one-line panes: how many item chips a pane's room holds, and what a chip shows.

import { FLOW_TOLERANCE } from '../../solver/index'
import type { SlotModel, SummaryPaneKind } from './summarySegments'

/** A chip is 32px wide with 6px after it (the table's 38px slot). */
export const LINE_CHIP_SLOT = 38
/** Room kept for the "+N" button when some items do not fit. */
export const LINE_MORE_ROOM = 34

/**
 * How many of `count` chips fit in `room` px: all of them when they fit; otherwise as many as fit
 * beside the "+N" button (none when even that leaves no room).
 */
export function lineChipFit(room: number, count: number): number {
  const all = Math.max(0, Math.floor(room / LINE_CHIP_SLOT))
  if (count <= all) return count
  return Math.max(0, Math.floor((room - LINE_MORE_ROOM) / LINE_CHIP_SLOT))
}

/** What a slot shows in the line, items/min. A product with a goal shows the goal and, when the output differs, the actual beside it. */
export interface LineRate { shown: number; actual?: number; short: boolean }
export function lineRate(pane: SummaryPaneKind, slot: SlotModel): LineRate {
  const p = slot.product
  if (pane !== 'products' || !p || slot.empty || p.required <= FLOW_TOLERANCE) return { shown: slot.rate, short: false }
  return { shown: p.required, actual: p.tickAt !== null ? p.actual : undefined, short: p.short }
}
