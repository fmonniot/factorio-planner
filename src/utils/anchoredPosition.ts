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
