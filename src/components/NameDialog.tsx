import { useState } from 'react'
import { ModalPortal } from './ModalPortal'
import { Modal } from './Modal'

interface NameDialogProps {
  /** Heading, e.g. "Rename block". */
  title: string
  /** Accessible name of the text field, e.g. "Block name". */
  label: string
  /** Text of the confirming button. */
  submitLabel: string
  initialName: string
  maxLength?: number
  /** Called with the trimmed name; a blank name cannot be submitted. */
  onSubmit: (name: string) => void
  onClose: () => void
}

/** A one-field "type a name" modal, replacing `window.prompt`. Portalled, so it works inside table rows and draggable tabs. */
export function NameDialog({ title, label, submitLabel, initialName, maxLength, onSubmit, onClose }: NameDialogProps) {
  const [name, setName] = useState(initialName)
  const blank = name.trim() === ''
  return (
    <ModalPortal>
    <Modal onClose={onClose} className="p-4 w-80 text-sm">
      <form
        role="dialog"
        aria-label={title}
        onSubmit={e => {
          e.preventDefault()
          if (!blank) onSubmit(name.trim())
        }}
      >
        <h2 className="font-semibold text-gray-100 mb-2">{title}</h2>
        <input
          aria-label={label}
          value={name}
          maxLength={maxLength}
          autoFocus
          onFocus={e => e.currentTarget.select()}
          onChange={e => setName(e.target.value)}
          className="w-full mb-3 text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded px-2 py-1"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-xs bg-gray-800 text-gray-300 hover:text-gray-100 border border-gray-600 rounded px-3 py-1">Cancel</button>
          <button
            type="submit"
            disabled={blank}
            className="text-xs bg-blue-600 text-white hover:bg-blue-500 rounded px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
    </ModalPortal>
  )
}
