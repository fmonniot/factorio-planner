import { MISSING_BLOCK_COLOR, withAlpha } from '../../data/blockColors'
import type { OverlayKind, SegmentKind } from './summarySegments'

export const AMBER = '#fbbf24'

// ---------------------------------------------------------------------------
// Segment looks — one per kind, shared by the micro-bar, the detail bar, the
// strip's legend and the overview rows so they read as one key.
// ---------------------------------------------------------------------------

export interface SegmentLook {
  /** fill of the detail bar, swatches and overview bars */
  bg: string
  border: string
  borderStyle: 'solid' | 'dashed'
  /** label colour inside the detail bar */
  text: string
  /** label colour in the strip's legend */
  legend: string
  /** solid colour in the slot's micro-bar */
  mini: string
}

export function segmentLook(
  kind: SegmentKind | OverlayKind,
  blockColor: string | undefined,
  limited = false,
): SegmentLook {
  switch (kind) {
    case 'export':
    case 'source': {
      const c = blockColor ?? MISSING_BLOCK_COLOR
      return {
        bg: withAlpha(c, 0.32),
        border: limited ? AMBER : withAlpha(c, 0.75),
        borderStyle: 'solid',
        text: '#f3f4f6',
        legend: limited ? AMBER : '#d1d5db',
        mini: limited ? AMBER : c,
      }
    }
    case 'kept':
    case 'left': return { bg: '#111827', border: '#4b5563', borderStyle: 'solid', text: '#9ca3af', legend: '#9ca3af', mini: '#4b5563' }
    case 'import': return { bg: 'transparent', border: '#9ca3af', borderStyle: 'solid', text: '#d1d5db', legend: '#d1d5db', mini: '#9ca3af' }
    case 'short': return { bg: 'rgba(251, 191, 36, .08)', border: AMBER, borderStyle: 'dashed', text: AMBER, legend: AMBER, mini: 'rgba(251, 191, 36, .55)' }
    case 'locked':
      return {
        bg: 'repeating-linear-gradient(135deg, #374151 0 4px, #1f2937 4px 8px)',
        border: '#374151',
        borderStyle: 'solid',
        text: '#9ca3af',
        legend: '#9ca3af',
        mini: '#374151',
      }
    case 'unused':
    case 'cycle':
    case 'missing-source':
      return { bg: 'transparent', border: '#4b5563', borderStyle: 'dashed', text: '#9ca3af', legend: '#9ca3af', mini: '#374151' }
  }
}

/** Swatch / bar style of a look: fill plus a 1px border of the look's style. */
export function lookStyle(look: SegmentLook): React.CSSProperties {
  return { background: look.bg, border: `1px ${look.borderStyle} ${look.border}`, boxSizing: 'border-box' }
}
