export interface Box { left: number; top: number; right: number; bottom: number }

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
): { left: number; top: number } {
  let left = anchor.right + gap
  if (left + size.width > viewport.width - margin) left = anchor.left - gap - size.width
  left = Math.max(margin, Math.min(left, viewport.width - size.width - margin))
  const maxTop = viewport.height - size.height - margin
  const top = maxTop < margin ? margin : Math.max(margin, Math.min(anchor.top, maxTop))
  return { left, top }
}

/**
 * Where to put a fixed-position popup of `size` under `anchor` (a small button): its left edge 16px before the anchor's, a
 * 4px gap below it, flipped above the anchor when it does not fit below (and when it fits neither way, pushed up until it is
 * on screen), clamped inside the viewport horizontally. Unlike `anchoredPosition` it stays over the anchor's column.
 */
export function anchoredBelow(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 4,
  margin = 8,
): { left: number; top: number } {
  const left = Math.max(margin, Math.min(anchor.left - 16, viewport.width - size.width - margin))
  let top = anchor.bottom + gap
  if (top + size.height > viewport.height - margin) {
    const above = anchor.top - gap - size.height
    top = above >= margin ? above : Math.max(margin, viewport.height - size.height - margin)
  }
  return { left, top }
}
