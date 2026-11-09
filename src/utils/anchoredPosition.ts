export interface Box { left: number; top: number; right: number; bottom: number }

/** A popup's position; `maxHeight` is set when the popup has to be shorter than it wants to be to stay clear of its anchor. */
export interface Placement { left: number; top: number; maxHeight?: number }

/**
 * Where to put a fixed-position popup of `size` next to `anchor`: to its right, flipped
 * to its left when that overflows, top-aligned, and clamped inside the viewport.
 */
export function anchoredPosition(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
  margin = 8,
): Placement {
  let left = anchor.right + gap
  if (left + size.width > viewport.width - margin) left = anchor.left - gap - size.width
  left = Math.max(margin, Math.min(left, viewport.width - size.width - margin))
  const maxTop = viewport.height - size.height - margin
  const top = maxTop < margin ? margin : Math.max(margin, Math.min(anchor.top, maxTop))
  return { left, top }
}

/**
 * Where to put a fixed-position popup of `size` under `anchor` (a small button): its left edge 16px before the anchor's, a
 * 4px gap below it, flipped above the anchor when it does not fit below, clamped inside the viewport horizontally. Unlike
 * `anchoredPosition` it stays over the anchor's column. When it fits neither below nor above (a short screen) it takes the
 * side with more room and returns that room as `maxHeight`, for the popup to scroll in: it never covers its anchor.
 */
export function anchoredBelow(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 4,
  margin = 8,
): Placement {
  const left = Math.max(margin, Math.min(anchor.left - 16, viewport.width - size.width - margin))
  const roomBelow = viewport.height - margin - (anchor.bottom + gap)
  const roomAbove = anchor.top - gap - margin
  if (size.height <= roomBelow) return { left, top: anchor.bottom + gap }
  if (size.height <= roomAbove) return { left, top: anchor.top - gap - size.height }
  return roomBelow >= roomAbove
    ? { left, top: anchor.bottom + gap, maxHeight: Math.max(0, roomBelow) }
    : { left, top: margin, maxHeight: Math.max(0, roomAbove) }
}
