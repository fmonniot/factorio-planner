import { makeHereOf, presetOf, type SourcingPreset } from '../../data/sourceRules'
import { areaName } from '../../data/subPlanTree'
import type { SubPlan } from '../../data/types'
import type { SourceRuleKind, SourceRulePart } from './sourceRules'

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

/**
 * The Leftover switch (on unless the item's block rule has `leftoverOff`): its name and fixed help text. Off is the surplus rule
 * of the solver (`LEFTOVER_COST`): the rows use the item up where they can. The text carries the two limits of the rule.
 */
const LEFTOVER_HELP = 'Off: the rows of this block use all of it they can. What they cannot use is still left over, and the warning names it.'
export const LEFTOVER_SWITCH = {
  label: 'Leftover',
  /** The rule's own line in the Source rules list. */
  help: LEFTOVER_HELP,
  /** The tooltip: the line and the two limits. */
  title: `${LEFTOVER_HELP} Turn it off on every item of a chain, or the leftover moves to the next item. An input the loop needs from a connection: set it to Receive it first.`,
}

/** The note under the Leftover switch at area scope: the rule is the block's, so the control only shows it. */
export const LEFTOVER_BLOCK_NOTE = 'Set for the whole block'

/** The button of that note: it switches the control to the whole block, where the switch is. */
export const LEFTOVER_BLOCK_BUTTON = 'Whole block'

/** The strip action of a Byproducts slot that turns Leftover off for the item: its name and tooltip. */
export const USE_IT_ALL_ACTION = {
  label: 'Use it all here',
  title: 'Turn Leftover off for this item: the rows of this block use all of it they can.',
  /** The action when Leftover is already off for the item: the rows cannot use more of it. */
  offTitle: 'Leftover is already off for this item: no row of this block can use more of it.',
}

/** The grey note under the Leftover switch for a block that takes the item from this one. */
export function leftoverTakeNote(blockName: string, itemName: string): string {
  return `${blockName} takes ${itemName} from this block. It gets only what the rows here cannot use; make ${itemName} a product to send it more.`
}

/** The name of each kind of rule: the preset's name, and the Import and Leftover switches turned off. */
export const SOURCE_RULE_NAMES: Record<SourceRuleKind, string> = {
  'connections-first': ITEM_SOURCING_CHOICES[1].label,
  'byproducts-first': ITEM_SOURCING_CHOICES[2].label,
  'import-off': `${IMPORT_SWITCH.label} off`,
  'leftover-off': `${LEFTOVER_SWITCH.label} off`,
  'make-here': ITEM_SOURCING_CHOICES[0].label,
  'import-on': `${IMPORT_SWITCH.label} on`,
  'takes-nothing': 'Takes nothing',
}

/** The name of a rule of an area, as the rule list and the remove button read it: "Line L: Receive it first". */
export const areaRuleLabel = (areaName: string, ruleName: string): string => `${areaName}: ${ruleName}`

/** The name of one part of a rule as the rule list and the remove button read it: the preset's name, "Line L: Import off", "Line L: takes nothing from Line M1". */
export function ruleLabel(rule: Pick<SourceRulePart, 'kind' | 'areaId' | 'otherAreaId'>, rootPlan: SubPlan): string {
  if (rule.areaId === undefined) return SOURCE_RULE_NAMES[rule.kind]
  const area = areaName(rootPlan, rule.areaId)
  if (rule.kind === 'takes-nothing' && rule.otherAreaId !== undefined) return `${area}: takes nothing from ${areaName(rootPlan, rule.otherAreaId)}`
  return areaRuleLabel(area, SOURCE_RULE_NAMES[rule.kind])
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

export type LineKey = 'made-here' | 'make-here' | 'other-areas' | `area:${string}` | 'block' | 'import'

/** The help text of the line of one supplying area, at area scope. */
export const AREA_LINE_HELP = 'Take it from the rows of this area. Off: nothing of it comes from this area.'

/** Where *Make more here* is drawn against the block lines. */
export type Side = 'above' | 'below'

/**
 * The lines top to bottom. *Already made here* is first and *Import* last. *Make more here* is above the block lines (no `makeHere`) or
 * below them (`'after-blocks'`), and *Other areas* always follows it directly (plan.md's mapping table); switched off it keeps the
 * side it was drawn last (`lastSide`) and *Other areas* follows *Already made here*. At area scope `supplierAreas` (the areas that
 * supply the item, table order) turns *Other areas* into one `area:<id>` line each, in the same place.
 */
export function sourcesLineOrder(makeHere: 'after-blocks' | 'off' | undefined, hasAreas: boolean, lastSide: Side, supplierAreas?: readonly string[]): LineKey[] {
  const areas: LineKey[] = hasAreas ? (supplierAreas && supplierAreas.length > 0 ? supplierAreas.map((id): LineKey => `area:${id}`) : ['other-areas']) : []
  if (makeHere === 'off') {
    return ['made-here', ...areas, ...(lastSide === 'above' ? ['make-here', 'block'] as const : ['block', 'make-here'] as const), 'import']
  }
  return makeHere === 'after-blocks'
    ? ['made-here', 'block', 'make-here', ...areas, 'import']
    : ['made-here', 'make-here', ...areas, 'block', 'import']
}
