import { useState } from 'react'
import { PLAN_NAME_MAX_LENGTH } from '../store/persistence'
import { Modal } from './Modal'

export function PlanNameDialog({ initialName, onSubmit, onClose }: { initialName: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initialName)
  const blank = name.trim() === ''
  return (
    <Modal onClose={onClose} className="p-4 w-80 text-sm">
      <form
        onSubmit={e => {
          e.preventDefault()
          if (!blank) onSubmit(name)
        }}
      >
        <h2 className="font-semibold text-gray-100 mb-2">Rename plan</h2>
        <input
          aria-label="Plan name"
          value={name}
          maxLength={PLAN_NAME_MAX_LENGTH}
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
            Rename
          </button>
        </div>
      </form>
    </Modal>
  )
}
