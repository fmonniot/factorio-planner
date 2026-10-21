import { useState } from 'react'
import type { RateUnit } from '../../store/uiStore'

/**
 * Inline number input for a rate shown in the display unit and committed in
 * items/min. Enter or blur commits, Escape cancels. With `allowClear`, an
 * empty field commits `undefined`.
 */
export function RateInput({
  initial,
  rateUnit,
  ariaLabel,
  allowClear = false,
  onCommit,
  onStop,
}: {
  initial: string
  rateUnit: RateUnit
  ariaLabel: string
  allowClear?: boolean
  onCommit: (perMin: number | undefined) => void
  onStop: () => void
}) {
  const [draft, setDraft] = useState(initial)

  function commit() {
    // Untouched field: the initial string is rounded for display, so committing
    // it would silently rewrite the stored value.
    if (draft === initial) {
      onStop()
      return
    }
    if (allowClear && draft.trim() === '') {
      onCommit(undefined)
    } else {
      const v = parseFloat(draft)
      if (isFinite(v) && v > 0) {
        // Convert from display unit back to items/min for storage
        onCommit(rateUnit === 'min' ? v : v * 60)
      }
    }
    onStop()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') {
      // Cancel the edit only: the pane must not also clear the selection.
      e.preventDefault()
      e.stopPropagation()
      onStop()
    }
  }

  return (
    <input
      type="number"
      min="0.001"
      step="any"
      autoFocus
      aria-label={ariaLabel}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      className="w-14 bg-gray-700 text-yellow-300 rounded px-1 py-0 border border-yellow-600 outline-none text-right tabular-nums text-[11px]"
    />
  )
}
