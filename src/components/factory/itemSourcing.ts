import type { SourceRule } from '../../data/types'
import type { SourceRuleKind } from './sourceRules'

// ---------------------------------------------------------------------------
// How a block sources an item: the three presets and the Import switch, read by every surface that shows them.
// ---------------------------------------------------------------------------

/** A preset other than Make it here, as the controls and the sentences name it. */
export type SourcingPreset = 'byproducts-first' | 'connections-first'

/** The preset a rule chooses: where its `makeHere` sits; undefined (Make it here) when it has none. */
export function presetOf(rule: SourceRule | undefined): SourcingPreset | undefined {
  return rule?.makeHere === 'after-blocks' ? 'connections-first' : rule?.makeHere === 'off' ? 'byproducts-first' : undefined
}

/** The `makeHere` value a preset stores. */
export function makeHereOf(preset: SourcingPreset | undefined): 'after-blocks' | 'off' | undefined {
  return preset === 'connections-first' ? 'after-blocks' : preset === 'byproducts-first' ? 'off' : undefined
}

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

/** Why the Import switch is disabled while "Don't make more here" is chosen. */
export const RELIES_ON_IMPORT_TEXT = "Don't make more here relies on imports for the rest."

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
