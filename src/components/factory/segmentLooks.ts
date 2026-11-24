import { MISSING_BLOCK_COLOR, withAlpha } from '../../data/blockColors'
import type { OverlayKind, SegmentKind } from './summarySegments'
import type { LineLook } from './sourcesModel'

export const AMBER = '#fbbf24'

/** Light diagonal stripes (135°, the slant of the locked ones too: lighter, so the two stay apart) on the pane's dark ground: nothing connects this share, it comes from outside. */
const IMPORT_GREY = '#d1d5db'
const IMPORT_STRIPES = `repeating-linear-gradient(135deg, ${withAlpha(IMPORT_GREY, 0.28)} 0 3px, ${withAlpha(IMPORT_GREY, 0.08)} 3px 6px)`

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
  /** fill of the slot's micro-bar: a solid colour, or a stripe gradient (import, locked) */
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
    case 'import': return { bg: IMPORT_STRIPES, border: '#9ca3af', borderStyle: 'solid', text: '#f3f4f6', legend: IMPORT_GREY, mini: IMPORT_STRIPES }
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
    case 'self':
    case 'missing-source':
      return { bg: 'transparent', border: '#4b5563', borderStyle: 'dashed', text: '#9ca3af', legend: '#9ca3af', mini: '#374151' }
  }
}

/** Swatch / bar style of a look: fill plus a 1px border of the look's style. */
export function lookStyle(look: SegmentLook): React.CSSProperties {
  return { background: look.bg, border: `1px ${look.borderStyle} ${look.border}`, boxSizing: 'border-box' }
}

const MADE_TEAL = '#14b8a6'

/** The look of what this block makes itself (the Sources list's made-here, make-more and other-area lines): teal. */
export function madeLook(): SegmentLook {
  return {
    bg: withAlpha(MADE_TEAL, 0.32),
    border: withAlpha(MADE_TEAL, 0.75),
    borderStyle: 'solid',
    text: '#f3f4f6',
    legend: '#d1d5db',
    mini: MADE_TEAL,
  }
}

/** The segment look of a line of the Sources list. */
export function lookOfLine(look: LineLook): SegmentLook {
  switch (look.kind) {
    case 'block': return segmentLook('source', look.color, look.limited)
    case 'made': return madeLook()
    case 'import': return segmentLook('import', undefined)
    case 'missing': return segmentLook('short', undefined)
  }
}
