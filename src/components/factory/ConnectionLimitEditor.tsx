import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { RateInput } from './RateInput'
import { isElectricity } from '../../data/electricity'
import type { RateUnit } from '../../store/uiStore'

// ---------------------------------------------------------------------------
// ConnectionLimitEditor — floating rate input that caps a connection (opened from the connection menu)
// ---------------------------------------------------------------------------

interface ConnectionLimitEditorProps {
  /** Viewport coordinates of the right-click that opened the menu. */
  x: number
  y: number
  /** Current limit in the display unit; '' when there is none. */
  initial: string
  /** The limited item: electricity is limited in MW. */
  itemId?: string
  rateUnit: RateUnit
  /** Receives items/min, or undefined when the field was emptied. */
  onCommit: (perMin: number | undefined) => void
  onClose: () => void
}

export function ConnectionLimitEditor({ x, y, initial, itemId, rateUnit, onCommit, onClose }: ConnectionLimitEditorProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Shift the box back into the viewport when it would overflow the right or bottom edge.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.max(0, Math.min(x, window.innerWidth - width)),
      y: Math.max(0, Math.min(y, window.innerHeight - height)),
    })
  }, [x, y])

  // A fixed box would float away from its segment, so close on scroll, resize and focus loss.
  // Closing never writes: RateInput only commits on Enter or its own blur.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    const dismiss = () => onCloseRef.current()
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [])

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', left: pos.x, top: pos.y }}
      className="z-50 bg-gray-800 border border-gray-600 rounded shadow-lg p-1.5 flex items-center gap-1 text-xs text-gray-400"
      // Synthetic events bubble through the portal to the pane's handlers; stop them here.
      onContextMenu={e => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <span>Limit</span>
      <RateInput
        initial={initial}
        rateUnit={rateUnit}
        ariaLabel="Connection limit"
        allowClear
        onCommit={onCommit}
        onStop={onClose}
      />
      <span>{isElectricity(itemId) ? 'MW' : rateUnit === 'min' ? '/m' : '/s'}</span>
    </div>,
    document.body,
  )
}
