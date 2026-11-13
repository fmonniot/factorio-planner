import { makeHereOf, presetOf, type SourcingPreset } from '../../data/sourceRules'
import type { SourceRuleKind } from './sourceRules'

// ---------------------------------------------------------------------------
// How a block sources an item: the three presets and the Import switch, read by every surface that shows them.
// ---------------------------------------------------------------------------

export { makeHereOf, presetOf, type SourcingPreset }

/** The label of the control that holds the three presets and the Import switch. */
export const COMES_FROM_LABEL = 'Comes from'

/** The three presets: the name shown, and the fixed help text shown as a tooltip. `mode` is what the block stores. */
export const ITEM_SOURCING_CHOICES: { mode: SourcingPreset | undefined; label: string; title: string }[] = [
  {
    mode: undefined,
    label: 'Make it here',
    title: 'Made here; connections and imports cover what is missing.',
  },
  {
    mode: 'connections-first',
    label: 'Receive it first',
    title: "Taken from this block's connections first; made here for the rest.",
  },
  {
    mode: 'byproducts-first',
    label: "Don't make more here",
    title: 'Runs no row for this item: uses what this block already makes, then its connections, then Import.',
  },
]

/** The Import switch (on unless the item's rule has `importOff`): its name and fixed help text. */
export const IMPORT_SWITCH = {
  label: 'Import',
  title: 'Bring it in from outside the plan. Off: what the other sources leave is shown as missing.',
}

/** The name of each kind of rule: the preset's name, and the Import switch turned off. */
export const SOURCE_RULE_NAMES: Record<SourceRuleKind, string> = {
  'connections-first': ITEM_SOURCING_CHOICES[1].label,
  'byproducts-first': ITEM_SOURCING_CHOICES[2].label,
  'import-off': `${IMPORT_SWITCH.label} off`,
}

// ---------------------------------------------------------------------------
// The Sources list (phase 2 of sourcing priority), named with the author on 2026-11-12. Nothing draws it yet.
// ---------------------------------------------------------------------------

/** The button of the Comes from control that opens the Sources list. It only opens the list, in every phase. */
export const SOURCES_BUTTON_LABEL = 'Sources…'

/**
 * The fixed lines of the Sources list: the name shown, and the help text shown as a tooltip and under the focused line.
 * `other-blocks` has no line of its own: each connection is a line named after its source, and carries this help text.
 * The Import line holds the same switch as the Comes from control, so it carries that switch's name and help text.
 */
export const SOURCES_LINES = {
  'made-here': {
    label: 'Already made here',
    title: "What this block's rows already make while running for something else: byproducts and spare output. Using it adds no machines.",
  },
  'make-here': {
    label: 'Make more here',
    title: "Run this block's rows, or more of them, for this item. Adds machines.",
  },
  'other-areas': {
    label: 'Other areas',
    title: 'Take it from rows in another area of this block.',
  },
  'other-blocks': {
    label: 'Other blocks',
    title: "Receive it from a connected block, up to the connection's limit.",
  },
  import: IMPORT_SWITCH,
} as const satisfies Record<string, { label: string; title: string }>

// ---------------------------------------------------------------------------
// The order of the Sources list's lines, a function of the rule and of the block.
// ---------------------------------------------------------------------------

export type LineKey = 'made-here' | 'make-here' | 'other-areas' | 'block' | 'import'

/** Where *Make more here* is drawn against the block lines. */
export type Side = 'above' | 'below'

/**
 * The lines top to bottom. *Already made here* is first and *Import* last. *Make more here* is above the block lines (no `makeHere`) or
 * below them (`'after-blocks'`), and *Other areas* always follows it directly (plan.md's mapping table); switched off it keeps the
 * side it was drawn last (`lastSide`) and *Other areas* follows *Already made here*.
 */
export function sourcesLineOrder(makeHere: 'after-blocks' | 'off' | undefined, hasAreas: boolean, lastSide: Side): LineKey[] {
  const areas: LineKey[] = hasAreas ? ['other-areas'] : []
  if (makeHere === 'off') {
    return ['made-here', ...areas, ...(lastSide === 'above' ? ['make-here', 'block'] as const : ['block', 'make-here'] as const), 'import']
  }
  return makeHere === 'after-blocks'
    ? ['made-here', 'block', 'make-here', ...areas, 'import']
    : ['made-here', 'make-here', ...areas, 'block', 'import']
}
