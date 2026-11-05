import { useEffect, useRef, type RefObject } from 'react'

/**
 * Calls `onDismiss` on a mouse press outside `ref` and on Esc while `active`. The Esc is marked as handled
 * (capture phase, `preventDefault`) so a picker closes before anything else reacts to the key.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, active: boolean, onDismiss: () => void): void {
  const latest = useRef(onDismiss)
  useEffect(() => {
    latest.current = onDismiss
  })
  useEffect(() => {
    if (!active) return
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) latest.current()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      latest.current()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [ref, active])
}
