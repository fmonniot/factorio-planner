import { useState } from 'react'
import type { RateUnit } from '../../store/uiStore'
import { useEscapeLayer } from './sidePanel/useDismiss'

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
  /** The edit is over: `how` is 'key' after Enter or Escape, 'blur' when the focus left the field on its own. */
  onStop: (how: 'key' | 'blur') => void
}) {
  const [draft, setDraft] = useState(initial)
  // Escape cancels the edit and nothing else (not the popover or pane the field sits in): it takes the first Esc of the stack.
  useEscapeLayer(true, () => onStop('key'))

  function commit(how: 'key' | 'blur') {
    // Untouched field: the initial string is rounded for display, so committing
    // it would silently rewrite the stored value.
    if (draft === initial) {
      onStop(how)
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
    onStop(how)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      // The key's default action must not follow focus to whatever takes it when the field closes (a button would click).
      e.preventDefault()
      commit('key')
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
      onBlur={() => commit('blur')}
      onKeyDown={handleKeyDown}
      className="w-14 bg-gray-700 text-yellow-300 rounded px-1 py-0 border border-yellow-600 outline-none text-right tabular-nums text-[11px]"
    />
  )
}
