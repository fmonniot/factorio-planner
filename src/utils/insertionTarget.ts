/**
 * Where an item at index `from` ends up when it is dropped at the insertion index `toIndex`
 * (an index in the current order, 0..length, counted before the item is removed; clamped).
 * Null when the item would not move.
 */
export function insertionTarget(from: number, toIndex: number, length: number): number | null {
  if (from < 0 || from >= length) return null
  const clamped = Math.max(0, Math.min(toIndex, length))
  const to = from < clamped ? clamped - 1 : clamped
  return to === from ? null : to
}
