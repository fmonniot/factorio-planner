import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { anchoredPosition } from '../utils/anchoredPosition'
import type { Box } from '../utils/anchoredPosition'

// ---------------------------------------------------------------------------
// useHoverPopup — timing, placement and dismissal of a popup that follows one
// trigger. Hover opens it after a delay, keyboard focus at once, a click pins
// it. The pointer can move onto the popup (a short grace period bridges the gap).
// The caller renders the popup in a portal with `popupProps`.
// ---------------------------------------------------------------------------

export const HOVER_OPEN_DELAY_MS = 300
export const HOVER_HIDE_GRACE_MS = 100
const FOCUS_SCROLL_GRACE_MS = 300

export function useHoverPopup<T extends HTMLElement>() {
  const id = useId()
  const [anchor, setAnchor] = useState<Box | null>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const open = anchor !== null

  const triggerRef = useRef<T>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const graceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const stickyRef = useRef(false) // pinned by a click or opened by focus: the pointer leaving does not close it
  const pointerDownRef = useRef(false) // a pointer press is in flight: the focus it causes does not open the popup
  const focusOpenedAt = useRef(0) // when focus last opened the popup: the scroll that brings the trigger into view re-anchors it

  const clearTimers = useCallback(() => {
    clearTimeout(openTimer.current)
    clearTimeout(graceTimer.current)
  }, [])

  const hide = useCallback(() => {
    clearTimers()
    stickyRef.current = false
    setAnchor(null)
  }, [clearTimers])

  const show = useCallback((sticky: boolean) => {
    const el = triggerRef.current
    if (!el) return
    clearTimers() // a pending hover-open must not later turn a pin into a plain hover
    stickyRef.current = sticky
    const { left, top, right, bottom } = el.getBoundingClientRect()
    setAnchor({ left, top, right, bottom })
  }, [clearTimers])

  // Measure, then flip or clamp into the viewport before paint; again whenever the popup resizes.
  const place = useCallback(() => {
    const el = popupRef.current
    if (!anchor || !el) return
    const { width, height } = el.getBoundingClientRect()
    const next = anchoredPosition(anchor, { width, height }, { width: window.innerWidth, height: window.innerHeight })
    setPos(prev => (prev.left === next.left && prev.top === next.top ? prev : next))
  }, [anchor])
  useLayoutEffect(place, [place])
  useEffect(() => {
    const el = popupRef.current
    if (!open || !el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open, place])

  // Dismissals. A scroll moves the trigger away from the anchor, so it closes the popup too (except
  // a scroll inside a long popup); a drag can start on the draggable row holding the trigger.
  useEffect(() => {
    if (!open) return
    const inside = (target: EventTarget | null) =>
      target instanceof Node && (triggerRef.current?.contains(target) || popupRef.current?.contains(target))
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      hide()
    }
    const onPointerDown = (e: PointerEvent) => { if (!inside(e.target)) hide() }
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && popupRef.current?.contains(e.target)) return
      // Focusing the trigger may scroll it into view; follow it rather than closing at once.
      if (Date.now() - focusOpenedAt.current < FOCUS_SCROLL_GRACE_MS) { show(true); return }
      hide()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', hide)
    window.addEventListener('blur', hide)
    window.addEventListener('dragstart', hide, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', hide)
      window.removeEventListener('blur', hide)
      window.removeEventListener('dragstart', hide, true)
    }
  }, [open, hide, show])

  useEffect(() => clearTimers, [clearTimers])

  const onMouseEnter = () => {
    clearTimeout(graceTimer.current)
    if (open) return
    clearTimeout(openTimer.current)
    openTimer.current = setTimeout(() => show(false), HOVER_OPEN_DELAY_MS)
  }
  const onMouseLeave = () => {
    clearTimeout(openTimer.current)
    if (!open || stickyRef.current) return
    clearTimeout(graceTimer.current)
    graceTimer.current = setTimeout(hide, HOVER_HIDE_GRACE_MS)
  }

  const triggerProps = {
    ref: triggerRef,
    onMouseEnter,
    onMouseLeave,
    onPointerDown: () => {
      pointerDownRef.current = true
      // Not every press becomes a click (a drag, a release elsewhere): the press ends with the pointer.
      const end = () => {
        pointerDownRef.current = false
        for (const t of ['pointerup', 'pointercancel', 'dragstart']) window.removeEventListener(t, end, true)
      }
      for (const t of ['pointerup', 'pointercancel', 'dragstart']) window.addEventListener(t, end, true)
    },
    onFocus: () => {
      if (pointerDownRef.current) return
      focusOpenedAt.current = Date.now()
      show(true)
    },
    onBlur: hide,
    onClick: () => {
      pointerDownRef.current = false
      if (open && stickyRef.current) hide()
      else show(true)
    },
    'aria-describedby': open ? id : undefined,
  }

  const popupProps = {
    ref: popupRef,
    id,
    role: 'tooltip' as const,
    style: { position: 'fixed', left: pos.left, top: pos.top } satisfies CSSProperties,
    onMouseEnter,
    onMouseLeave,
    // Pressing inside the popup (its scrollbar, say) must not blur the trigger, which would close it.
    onMouseDown: (e: ReactMouseEvent) => e.preventDefault(),
  }

  return { open, hide, triggerProps, popupProps }
}
