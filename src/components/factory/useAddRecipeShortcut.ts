import { useKeyShortcut } from './useKeyShortcut'

/** The key that opens Add recipe (compared case-insensitively, so Caps Lock does not matter). */
export const ADD_RECIPE_KEY = 'r'

/**
 * Binds the Add recipe shortcut on the document, under the same guards as the Add product one:
 * ignored while typing, with a modifier, on IME composition or key repeat, and while any menu, popover, picker or modal is open.
 */
export function useAddRecipeShortcut(onAdd: () => void, enabled: boolean): void {
  useKeyShortcut(ADD_RECIPE_KEY, onAdd, enabled)
}
