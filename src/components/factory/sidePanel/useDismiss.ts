import { useEffect, useRef, type RefObject } from 'react'

type Inside = RefObject<HTMLElement | null>

/** Dismissible things currently open, oldest first: an Esc only reaches the last one. */
const open: object[] = []

/** Whether a dismissible is open now (read it in a capture handler, before the press closes it). */
export function isDismissibleOpen(): boolean {
  return open.length > 0
}

/**
 * While `active`, calls `onDismiss` on a mouse press outside every element of `inside` (a ref or a list of refs: the popup
 * and its trigger) and on Esc. Esc goes to the most recently opened dismissible only, and is marked as handled (capture
 * phase, `preventDefault`, `stopPropagation`) so nothing else reacts to that key press.
 */
export function useDismiss(inside: Inside | readonly Inside[], active: boolean, onDismiss: () => void): void {
  const latest = useRef({ inside, onDismiss })
  useEffect(() => {
    latest.current = { inside, onDismiss }
  })
  useEffect(() => {
    if (!active) return
    const token = {}
    open.push(token)
    function onMouseDown(e: MouseEvent) {
      const refs = ([] as Inside[]).concat(latest.current.inside as Inside | Inside[])
      const target = e.target as Node
      if (!refs.some(r => r.current?.contains(target))) latest.current.onDismiss()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || open[open.length - 1] !== token) return
      e.preventDefault()
      e.stopPropagation()
      latest.current.onDismiss()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown, true)
      open.splice(open.indexOf(token), 1)
    }
  }, [active])
}
