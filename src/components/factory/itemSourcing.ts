import type { ItemSourcingMode } from '../../data/types'

// ---------------------------------------------------------------------------
// How a block sources an item: the three presets and the Import switch, read by every surface that shows them.
// ---------------------------------------------------------------------------

/** The label of the control that holds the three presets and the Import switch. */
export const COMES_FROM_LABEL = 'Comes from'

/** The three presets: the name shown, and the fixed help text shown as a tooltip. `mode` is what the block stores. */
export const ITEM_SOURCING_CHOICES: { mode: ItemSourcingMode | undefined; label: string; title: string }[] = [
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
    label: "Only what's already made",
    title: 'Uses what this block already makes; the rest is received or imported.',
  },
]

/** The Import switch (on when the item is not in `Block.noImportItems`): its name and fixed help text. */
export const IMPORT_SWITCH = {
  label: 'Import',
  title: 'Bring it in from outside the plan. Off: this block must make or receive all of it.',
}

/** Why the Import switch is disabled while "Only what's already made" is chosen. */
export const RELIES_ON_IMPORT_TEXT = "Only what's already made relies on imports for the rest."
