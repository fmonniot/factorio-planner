import type { CSSProperties } from 'react'
import { MAX_NESTING_DEPTH } from '../../data/nesting'

/** Width of one nesting level in the Recipe column, and the cell's own left padding. */
export const GUIDE_WIDTH_PX = 12
const CELL_PADDING_PX = 8
const GUIDE_COLOR = '#2b3445'

/** Levels drawn for a node `depth` groups deep: the indent stops growing at the nesting limit (deeper plans still render). */
export function guideLevels(depth: number): number {
  return Math.min(Math.max(depth, 0), MAX_NESTING_DEPTH)
}

/**
 * Style of a Recipe cell `depth` groups deep: left padding for the indent and one 1px vertical guide
 * per level, drawn as backgrounds so each runs the full height of the row.
 */
export function treeGuideStyle(depth: number): CSSProperties {
  const levels = guideLevels(depth)
  const style: CSSProperties = { paddingLeft: `${CELL_PADDING_PX + levels * GUIDE_WIDTH_PX}px` }
  if (levels === 0) return style
  const each = (value: (i: number) => string) => Array.from({ length: levels }, (_, i) => value(i)).join(',')
  style.backgroundImage = each(() => `linear-gradient(${GUIDE_COLOR},${GUIDE_COLOR})`)
  style.backgroundSize = each(() => '1px 100%')
  style.backgroundPosition = each(i => `${CELL_PADDING_PX + i * GUIDE_WIDTH_PX}px 0`)
  style.backgroundRepeat = 'no-repeat'
  return style
}

/**
 * Background tint of a group row `depth` groups deep: a gray tint that gets darker
 * (less opaque) with each level and stops changing at the nesting limit. Full class
 * names so Tailwind sees them.
 */
const GROUP_TINTS = ['bg-gray-800/30', 'bg-gray-800/20', 'bg-gray-800/10', 'bg-gray-800/5'] as const

export function groupRowTint(depth: number): string {
  return GROUP_TINTS[Math.min(guideLevels(depth), GROUP_TINTS.length - 1)]
}

/**
 * Background of an open group's row: a faint teal band (teal-400 at 5%) instead of the gray tint, so the rows
 * below it read as belonging to it. A collapsed group keeps its tint. Full class names so Tailwind sees them.
 */
const OPEN_GROUP_BAND = 'bg-teal-400/5'

export function groupRowBackground(depth: number, open: boolean): string {
  return open ? OPEN_GROUP_BAND : groupRowTint(depth)
}

/**
 * The line under an open group's header (teal-400 at 28%), drawn inside every cell of the row: a shadow on the
 * row itself is not painted by every browser. A selected row does not get it (the selection has its own outline).
 */
export const OPEN_GROUP_HAIRLINE = 'shadow-[inset_0_-1px_0_rgba(45,212,191,0.28)]'

/**
 * Ingredient chips start at the left of their column, 28px further right than the cell's own 8px of padding.
 * A collapsed area row borrows the same 28px from the Products span for its "+N", so its first received chip
 * and a recipe row's first ingredient start at the same x. The Ingredients header is indented the same.
 */
export const INGREDIENTS_INDENT_PX = 28
export const INGREDIENTS_PADDING_LEFT = `${CELL_PADDING_PX + INGREDIENTS_INDENT_PX}px`
