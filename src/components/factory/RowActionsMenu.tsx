import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// ---------------------------------------------------------------------------
// RowActionsMenu — right-click context menu (recipe rows, byproduct tiles)
// ---------------------------------------------------------------------------

export interface RowAction {
  label: string
  onSelect: () => void
  danger?: boolean
  /** Shown but not selectable. */
  disabled?: boolean
}

interface RowActionsMenuProps {
  /** Viewport coordinates of the right-click. */
  x: number
  y: number
  actions: RowAction[]
  onClose: () => void
}

export function RowActionsMenu({ x, y, actions, onClose }: RowActionsMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // Keep the latest onClose in a ref so the document listeners bind once.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Shift the menu back into the viewport when it would overflow the right or bottom edge.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      x: Math.max(0, Math.min(x, window.innerWidth - width)),
      y: Math.max(0, Math.min(y, window.innerHeight - height)),
    })
  }, [x, y])

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCloseRef.current()
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Mark the key as handled (capture phase, before the pane's listener) so it does not also clear a selection.
      e.preventDefault()
      onCloseRef.current()
    }
    // A fixed menu would float away from its row, so close on scroll and focus loss.
    function handleDismiss() {
      onCloseRef.current()
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleDismiss)
    window.addEventListener('scroll', handleDismiss, true)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleDismiss)
      window.removeEventListener('scroll', handleDismiss, true)
    }
  }, [])

  return createPortal(
    <div
      ref={ref}
      role="menu"
      // Synthetic events bubble through the portal to the row's onContextMenu; stop them here.
      onContextMenu={e => {
        e.preventDefault()
        e.stopPropagation()
      }}
      style={{ position: 'fixed', left: pos.x, top: pos.y }}
      className="z-50 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 flex flex-col"
    >
      {actions.map(action => (
        <button
          key={action.label}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          className={`text-left whitespace-nowrap px-3 py-1 text-xs hover:bg-gray-700 disabled:opacity-40 disabled:hover:bg-transparent ${
            action.danger ? 'text-red-400' : 'text-gray-200'
          }`}
          onClick={() => {
            action.onSelect()
            onClose()
          }}
        >
          {action.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
