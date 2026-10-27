import type { ItemSourcingMode } from '../../data/types'
import type { RowAction } from './RowActionsMenu'

// ---------------------------------------------------------------------------
// How a block sources an item: the three choices shared by the chip menus and the Ingredients menu.
// ---------------------------------------------------------------------------

export const ITEM_SOURCING_CHOICES: { mode: ItemSourcingMode | undefined; label: string; title: string }[] = [
  {
    mode: undefined,
    label: 'Own recipes first',
    title: "This block's recipes make it; connections and imports cover only what they cannot",
  },
  {
    mode: 'byproducts-first',
    label: 'Byproducts first',
    title: 'Use what recipes running for other reasons make; import or connect the rest instead of running a recipe just for it',
  },
  {
    mode: 'connections-first',
    label: 'Connections first',
    title: "Use what this block's connections deliver before its own recipes, which make only the rest",
  },
]

const ACTION_IDS = { own: 'sourcing-own', 'byproducts-first': 'sourcing-byproducts', 'connections-first': 'sourcing-connections' }

/** Lower-case name of a mode, for tooltips. */
export function itemSourcingLabel(mode: ItemSourcingMode): string {
  return mode === 'byproducts-first' ? 'byproducts first' : 'connections first'
}

/**
 * The three choices as radio actions of a RowActionsMenu. `disabledTitle` disables them and explains why, except
 * "Own recipes first" while a mode is set: that one stays enabled so the entry can always be cleared.
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
