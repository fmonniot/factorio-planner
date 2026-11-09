import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useOverlayOpen } from './factory/sidePanel/useDismiss'

interface ModalProps {
  onClose: () => void
  children: ReactNode
  className?: string
}

export function Modal({ onClose, children, className = '' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  // An open modal owns Escape: the side panel drawer underneath must not also close on it.
  useOverlayOpen()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  // Caps apply unless the caller sets its own (utility order in the stylesheet, not class order, would pick the winner).
  // Variant-prefixed overrides (`md:max-w-lg`) count too; only an `overflow-y-*` or bare `overflow-*` (both axes) replaces the vertical scroll.
  const hasMaxW = /(^|\s)(?:[\w-]+:)*max-w-/.test(className)
  const hasOverflowY = /(^|\s)(?:[\w-]+:)*overflow-(?:y-|auto|hidden|visible|scroll|clip)/.test(className)
  const capClasses = [
    hasMaxW ? '' : 'max-w-[calc(100vw-1rem)]',
    'max-h-[calc(100dvh-1rem)]',
    hasOverflowY ? '' : 'overflow-y-auto',
  ].join(' ')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={handleBackdropClick}
    >
      <div
        ref={panelRef}
        data-testid="modal-panel"
        className={`bg-gray-900 border border-gray-700 rounded-lg shadow-2xl ${capClasses} ${className}`}
      >
        {children}
      </div>
    </div>
  )
}
