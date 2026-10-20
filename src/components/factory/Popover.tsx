import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'

interface PopoverProps {
  /** `escape` for the Escape key, `outside` for a pointerdown outside the panel. */
  onClose: (reason: 'escape' | 'outside') => void
  children: ReactNode
  className?: string
  /** A pointerdown inside this element does not close the popover (the trigger, so a click on it just toggles). */
  ignoreRef?: RefObject<HTMLElement | null>
}

/**
 * A lightweight absolute-positioned panel that closes on outside click or Escape.
 * The trigger element should be in a `relative`-positioned container.
 */
export function Popover({ onClose, children, className = '', ignoreRef }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  // Latest callback, so inline arrows do not re-subscribe the window listeners on every render.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    // Capture phase + preventDefault so Escape does not also clear the
    // summary pane selection (see MenuButton).
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onCloseRef.current('escape')
    }
    function onPointer(e: PointerEvent) {
      const target = e.target as Node
      if (ref.current && !ref.current.contains(target) && !ignoreRef?.current?.contains(target)) onCloseRef.current('outside')
    }
    window.addEventListener('keydown', onKey, { capture: true })
    window.addEventListener('pointerdown', onPointer, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true })
      window.removeEventListener('pointerdown', onPointer, { capture: true })
    }
  }, [ignoreRef])

  return (
    <div
      ref={ref}
      className={`absolute z-50 mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl ${className}`}
    >
      {children}
    </div>
  )
}
