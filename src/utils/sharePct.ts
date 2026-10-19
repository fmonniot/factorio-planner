/** Share limit (0–1 fraction) as a percentage string with at most one decimal. */
export function formatSharePct(maxShare: number): string {
  return (Math.round(maxShare * 1000) / 10).toString()
}

/** Strictly parse a percentage typed by the user; null when not a plain number in (0, 100). */
export function parseSharePct(raw: string | null): number | null {
  if (raw === null) return null
  const t = raw.trim()
  if (t === '') return null
  const v = Number(t)
  return Number.isFinite(v) && v > 0 && v < 100 ? v : null
}
