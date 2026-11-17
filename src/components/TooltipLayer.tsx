import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { anchoredAbove, type Placement } from '../utils/anchoredPosition'

/**
 * Instant tooltips for the elements that carry `data-tip`, drawn by one delegated layer (mounted once in `FactoryShell`).
 * The text is the attribute's value, or the element's `aria-label` when the value is empty. The tooltip is a fixed box on
 * `document.body`, so no scrolling or clipping container cuts it off; it is `aria-hidden` (the `aria-label` is the accessible
 * name) and never takes the pointer. Mouse and pen open it on hover, the keyboard on `:focus-visible`; touch does not.
 */

/** The text to show for an anchor: `data-tip` when it has a value, else the `aria-label`. */
// eslint-disable-next-line react-refresh/only-export-components
export function tipText(el: Element): string {
  return el.getAttribute('data-tip') || el.getAttribute('aria-label') || ''
}

const BOX_CLASS = 'fixed z-[70] bg-black text-gray-100 text-xs border border-gray-700 rounded px-2 py-1 max-w-[280px] pointer-events-none'

const anchorOf = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null

export function TooltipLayer() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [text, setText] = useState('')
  const [pos, setPos] = useState<Placement | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const open = (el: HTMLElement) => {
      const t = tipText(el)
      if (!t) return
      setAnchor(el)
      setText(t)
      setPos(null)
    }
    const close = () => setAnchor(null)
    const onOver = (e: Event) => {
      if ((e as PointerEvent).pointerType === 'touch') return
      const el = anchorOf(e.target)
      if (el) open(el)
      else close()
    }
    const onOut = (e: Event) => {
      if (!(e as PointerEvent).relatedTarget) close()
    }
    const onFocusIn = (e: Event) => {
      const el = anchorOf(e.target)
      if (!el) return
      let visible = false
      try { visible = el.matches(':focus-visible') } catch { /* no :focus-visible: stay closed */ }
      if (visible) open(el)
    }
    const onKey = (e: Event) => { if ((e as KeyboardEvent).key === 'Escape') close() }
    const doc: Array<[string, (e: Event) => void]> = [
      ['pointerover', onOver], ['pointerout', onOut], ['pointerdown', close], ['contextmenu', close],
      ['focusin', onFocusIn], ['focusout', close], ['keydown', onKey], ['scroll', close], ['dragstart', close],
    ]
    for (const [name, fn] of doc) document.addEventListener(name, fn, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      for (const [name, fn] of doc) document.removeEventListener(name, fn, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [])

  // While open: follow the anchor's text, and close when the anchor leaves the document.
  useEffect(() => {
    if (!anchor) return
    const attrs = new MutationObserver(() => setText(tipText(anchor)))
    attrs.observe(anchor, { attributes: true, attributeFilter: ['aria-label', 'data-tip'] })
    const tree = new MutationObserver(() => { if (!anchor.isConnected) setAnchor(null) })
    tree.observe(document.body, { childList: true, subtree: true })
    return () => { attrs.disconnect(); tree.disconnect() }
  }, [anchor])

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!anchor || !box) return
    const r = anchor.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    setPos(anchoredAbove(r, { width: b.width, height: b.height }, { width: window.innerWidth, height: window.innerHeight }))
  }, [anchor, text])

  if (!anchor || !text) return null
  return createPortal(
    <div
      ref={boxRef}
      aria-hidden="true"
      data-testid="tooltip"
      className={BOX_CLASS}
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {text}
    </div>,
    document.body,
  )
}
