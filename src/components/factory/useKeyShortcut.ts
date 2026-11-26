import { useEffect, useRef } from 'react'
import { isDismissibleOpen } from './sidePanel/useDismiss'
import { isTextTarget } from './useUndoShortcuts'

/** A field that takes typed letters: a text field, or a select that jumps to options by typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  return isTextTarget(target) || (target instanceof HTMLElement && target.tagName === 'SELECT')
}

/**
 * Binds a single-letter shortcut on the document (`key` is compared case-insensitively, so Caps Lock does not matter).
 * Ignored while typing, with a modifier, on IME composition or key repeat, and while any menu, popover, picker or modal is open.
 */
export function useKeyShortcut(key: string, onPress: () => void, enabled: boolean): void {
  const latest = useRef(onPress)
  useEffect(() => {
    latest.current = onPress
  })
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (e.key.toLowerCase() !== key) return
      if (isTypingTarget(e.target)) return
      // Also true for the undoable factory overview: the picker would open behind it, and the overview edits its goals itself.
      if (isDismissibleOpen()) return
      // Stops the letter from being typed into the search field the picker focuses.
      e.preventDefault()
      latest.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled, key])
}
