import { createPortal } from 'react-dom'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}

/** A destructive-action confirmation modal, replacing `window.confirm`. Portalled, so it works inside table rows. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  return createPortal(
    <Modal onClose={onClose} className="p-4 w-96 text-sm">
      <div role="alertdialog" aria-label={title}>
        <h2 className="font-semibold text-gray-100 mb-2">{title}</h2>
        <p className="text-gray-300 mb-3">{message}</p>
        <div className="flex justify-end gap-2">
          <button type="button" autoFocus onClick={onClose} className="text-xs bg-gray-800 text-gray-300 hover:text-gray-100 border border-gray-600 rounded px-3 py-1">Cancel</button>
          <button type="button" onClick={onConfirm} className="text-xs bg-red-600 text-white hover:bg-red-500 rounded px-3 py-1">{confirmLabel}</button>
        </div>
      </div>
    </Modal>,
    document.body,
  )
}
