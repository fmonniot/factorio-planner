import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Tracks whether a scrolling box has content hidden below its visible part
 * (drives a bottom fade). Attach `bodyRef` to the scrolling box, `contentRef`
 * to its content wrapper and `onScroll` to the box's scroll event.
 */
export function useMoreBelow<Body extends HTMLElement, Content extends HTMLElement>() {
  const bodyRef = useRef<Body>(null)
  const contentRef = useRef<Content>(null)
  const [hasMore, setHasMore] = useState(false)

  function measure() {
    const el = bodyRef.current
    if (!el) return
    const more = el.scrollTop + el.clientHeight < el.scrollHeight - 1
    setHasMore(prev => (prev === more ? prev : more))
  }

  // Content changes resize the body, so observe it as well as scrolling. The body's own box
  // stops changing at the height cap, so also re-measure after every render.
  useLayoutEffect(measure)

  useEffect(() => {
    const el = bodyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // The content wrapper changes size even while the capped body does not.
    if (contentRef.current) observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [])

  return { bodyRef, contentRef, hasMore, onScroll: measure }
}
