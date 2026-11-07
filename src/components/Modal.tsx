import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface ModalProps {
  onClose: () => void
  children: ReactNode
  className?: string
}

export function Modal({ onClose, children, className = '' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className={`bg-gray-900 border border-gray-700 rounded-lg shadow-2xl max-w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] overflow-y-auto ${className}`}
      >
        {children}
      </div>
    </div>
  )
}
