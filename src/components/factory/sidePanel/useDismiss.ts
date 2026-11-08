import { useEffect, useRef, type RefObject } from 'react'

type Inside = RefObject<HTMLElement | null>

/** Dismissible things currently open, oldest first: an Esc only reaches the last one. */
const open: object[] = []

/** Overlays that close themselves on an outside press but are not Esc-stacked dismissibles (menus, popovers). */
const guards: object[] = []

/** Whether a dismissible or a registered overlay is open right now. */
export function isDismissibleOpen(): boolean {
  return open.length > 0 || guards.length > 0
}

/** Registers an open overlay that handles its own dismissal, so a press that closes it is known (see `pressStartedOverCloseableOverlay`). */
export function useOverlayOpen(active = true): void {
  useEffect(() => {
    if (!active) return
    const token = {}
    guards.push(token)
    return () => { guards.splice(guards.indexOf(token), 1) }
  }, [active])
}

// Whether an overlay was open when the current press began. Taken in a window capture listener installed at module load,
// i.e. before any overlay's own outside-press listener can close it (and before React re-renders it away). A press
// produces pointerdown then mousedown: only the first one samples, so the overlay's own close cannot clear the flag.
let pressSawOverlay = false
let pointerSampled = false
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { pressSawOverlay = isDismissibleOpen(); pointerSampled = true }, true)
  window.addEventListener('mousedown', () => {
    if (!pointerSampled) pressSawOverlay = isDismissibleOpen()
    pointerSampled = false
  }, true)
}

/** Whether the press that is now being completed began while a menu, popover or picker was open (it only dismissed that). */
export function pressStartedOverCloseableOverlay(): boolean {
  return pressSawOverlay
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
