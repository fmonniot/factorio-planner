// Block display colours: the palette, how new blocks pick one, and how plans
// saved before blocks had a colour get theirs. Pure; no React or store imports.

/**
 * Colours a block can take. They avoid the hues that already carry meaning in
 * the summary panes: teal (actual rates, selection), amber (warnings) and grey
 * (kept, imported).
 */
export const BLOCK_PALETTE = [
  '#60a5fa', '#7dd3fc', '#818cf8', '#a78bfa', '#d8b4fe', '#e879f9', '#f472b6', '#fda4af',
  '#fca5a5', '#a5b4fc', '#a3e635', '#86efac', '#bfdbfe', '#fbcfe8', '#c4b5fd', '#f9a8d4',
] as const

export const HEX_COLOR_RE = /^#[0-9a-f]{6}$/

/** Colour used for a block that no longer exists (deleted source). */
export const MISSING_BLOCK_COLOR = '#6b7280'

/**
 * Pick a palette colour for a new block, preferring one nobody in `used` has,
 * then the least-used ones. `exclude` is never returned.
 */
export function pickBlockColor(
  used: readonly string[],
  opts: { exclude?: string; random?: () => number } = {},
): string {
  const counts = new Map<string, number>(BLOCK_PALETTE.map(c => [c, 0]))
  for (const u of used) {
    const key = u.toLowerCase()
    if (counts.has(key)) counts.set(key, counts.get(key)! + 1)
  }
  const exclude = opts.exclude?.toLowerCase()
  const open = BLOCK_PALETTE.filter(c => c !== exclude)
  const min = Math.min(...open.map(c => counts.get(c)!))
  const candidates = open.filter(c => counts.get(c) === min)
  return candidates[Math.floor((opts.random ?? Math.random)() * candidates.length)]
}

/**
 * AppState preprocess: give every block without a valid colour one from the
 * palette, in block order, so reloading an old plan always gives the same
 * colours. Colours already in the file are kept (lower-cased), duplicates included.
 */
export function assignMissingBlockColors(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const data = raw as Record<string, unknown>
  if (!Array.isArray(data.blocks)) return raw

  const validColor = (block: unknown): string | undefined => {
    if (typeof block !== 'object' || block === null) return undefined
    const c = (block as Record<string, unknown>).color
    return typeof c === 'string' && HEX_COLOR_RE.test(c.toLowerCase()) ? c.toLowerCase() : undefined
  }
  const taken = new Set(data.blocks.map(validColor).filter((c): c is string => c !== undefined))

  const blocks = data.blocks.map((block, i) => {
    if (typeof block !== 'object' || block === null) return block
    const color = validColor(block)
    if (color !== undefined) return { ...block, color }
    const free = BLOCK_PALETTE.find(c => !taken.has(c)) ?? BLOCK_PALETTE[i % BLOCK_PALETTE.length]
    taken.add(free)
    return { ...block, color: free }
  })
  return { ...data, blocks }
}

/** `#60a5fa`, 0.35 -> `rgba(96, 165, 250, 0.35)` */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
