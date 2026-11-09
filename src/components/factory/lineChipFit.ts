// Arithmetic of the collapsed summary's one-line panes: how many item chips a pane's room holds.

/** One chip is 24px wide with 6px after it. */
export const LINE_CHIP_SLOT = 30
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
