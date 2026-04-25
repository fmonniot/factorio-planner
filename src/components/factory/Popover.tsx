import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface PopoverProps {
  onClose: () => void
  children: ReactNode
  className?: string
}

/**
 * A lightweight absolute-positioned panel that closes on outside click or Escape.
 * The trigger element should be in a `relative`-positioned container.
 */
export function Popover({ onClose, children, className = '' }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer, { capture: true })
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className={`absolute z-50 mt-1 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl ${className}`}
    >
      {children}
    </div>
  )
}
