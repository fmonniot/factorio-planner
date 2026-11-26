import { useKeyShortcut } from './useKeyShortcut'

/** The key that opens Add product (compared case-insensitively, so Caps Lock does not matter). */
export const ADD_GOAL_KEY = 'a'

/**
 * Binds the Add product shortcut on the document.
 * Ignored while typing, with a modifier, on IME composition or key repeat, and while any menu, popover, picker or modal is open.
 */
export function useAddGoalShortcut(onAdd: () => void, enabled: boolean): void {
  useKeyShortcut(ADD_GOAL_KEY, onAdd, enabled)
}
