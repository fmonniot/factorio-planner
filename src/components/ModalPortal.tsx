import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

/**
 * Renders a modal into the body. React events still bubble through a portal to the component tree
 * around it (a table row that selects itself on click, a tab that starts a drag), so the pointer
 * events a dialog has no business sharing stop here. Mouse-down and keys are left alone: outside-click
 * and Escape listeners elsewhere rely on them.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(
    <div onClick={stop} onDoubleClick={stop} onContextMenu={stop} onDragStart={stop} onDragOver={stop} onDrop={stop}>
      {children}
    </div>,
    document.body,
  )
}
