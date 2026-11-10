import type { Block, GameData, ItemSourcingMode } from '../../data/types'
import { blockMakesItem } from '../../solver/index'
import type { RowAction } from './RowActionsMenu'

// ---------------------------------------------------------------------------
// How a block sources an item: the three choices shared by the chip menus and the Ingredients menu.
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
    mode: 'byproducts-first',
    label: "Only what's already made",
    title: 'Uses what this block already makes; the rest is received or imported.',
  },
  {
    mode: 'connections-first',
    label: 'Receive it first',
    title: "Taken from this block's connections first; made here for the rest.",
  },
]

/** The Import switch (on when the item is not in `Block.noImportItems`): its name and fixed help text. */
export const IMPORT_SWITCH = {
  label: 'Import',
  title: 'Bring it in from outside the plan. Off: this block must make or receive all of it.',
}

const ACTION_IDS = { own: 'sourcing-own', 'byproducts-first': 'sourcing-byproducts', 'connections-first': 'sourcing-connections' }

/**
 * Why "Forbid imports" is disabled for an item, or undefined when it is available. It is disabled when no
 * recipe row of the block makes the item (raw in the block, no LP row: a lock would change nothing) and the
 * item is not locked already (an existing lock can always be lifted).
 */
export function forbidImportsTitle(block: Block | undefined, gameData: GameData | undefined, itemId: string): string | undefined {
  if (!block || !gameData || block.noImportItems.includes(itemId)) return undefined
  if (blockMakesItem(block, gameData, itemId)) return undefined
  const name = gameData.items[itemId]?.name ?? itemId
  return `No recipe in this block makes ${name}, so forbidding imports would change nothing. Add a recipe that makes it first.`
}

/** Lower-case name of a mode, for tooltips. */
export function itemSourcingLabel(mode: ItemSourcingMode): string {
  return mode === 'byproducts-first' ? 'byproducts first' : 'connections first'
}

/**
 * The three choices as radio actions of a RowActionsMenu. `disabledTitle` disables them and explains why, except
 * "Make it here" while a mode is set: that one stays enabled so the entry can always be cleared.
 */
export function itemSourcingActions(
  current: ItemSourcingMode | undefined,
  onSet: (mode: ItemSourcingMode | undefined) => void,
  opts: { separate?: boolean; disabledTitle?: string } = {},
): RowAction[] {
  return ITEM_SOURCING_CHOICES.map(({ mode, label, title }, i) => {
    const disabled = opts.disabledTitle !== undefined && !(mode === undefined && current !== undefined)
    return {
      id: ACTION_IDS[mode ?? 'own'],
      label,
      title: disabled ? opts.disabledTitle : title,
      radio: true,
      checked: mode === current,
      disabled,
      separatorBefore: i === 0 && opts.separate === true,
      onSelect: () => onSet(mode),
    }
  })
}
