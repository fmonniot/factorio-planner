import { useEffect, useRef } from 'react'
import { isDismissibleOpen } from './sidePanel/useDismiss'
import { isTextTarget } from './useUndoShortcuts'

/** The key that opens Add product (compared case-insensitively, so Caps Lock does not matter). */
export const ADD_GOAL_KEY = 'a'

/** A field that takes typed letters: a text field, or a select that jumps to options by typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  return isTextTarget(target) || (target instanceof HTMLElement && target.tagName === 'SELECT')
}

/**
 * Binds the Add product shortcut on the document.
 * Ignored while typing, with a modifier, on IME composition or key repeat, and while any menu, popover, picker or modal is open.
 */
export function useAddGoalShortcut(onAdd: () => void, enabled: boolean): void {
  const latest = useRef(onAdd)
  useEffect(() => {
    latest.current = onAdd
  })
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (e.key.toLowerCase() !== ADD_GOAL_KEY) return
      if (isTypingTarget(e.target)) return
      // Also true for the undoable factory overview: the picker would open behind it, and the overview edits its goals itself.
      if (isDismissibleOpen()) return
      // Stops the letter from being typed into the search field the picker focuses.
      e.preventDefault()
      latest.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
