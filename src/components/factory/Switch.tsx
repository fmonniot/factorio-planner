// The small controls the Comes from control and the Sources list share.

/** A small bordered button: the Sources… button, the move buttons. */
export const MINI_BUTTON_CLASS =
  'bg-gray-900 border border-gray-700 rounded px-1.5 text-[11px] leading-4 text-gray-300 outline-none hover:border-gray-500 focus-visible:ring-2 focus-visible:ring-teal-400 aria-disabled:opacity-40 aria-disabled:hover:border-gray-700'

/**
 * A switch (`role="switch"`) with the track the Comes from control draws. `children` is its visible name; without it the
 * switch is named by `label` (a line of the Sources list already shows the name).
 */
export function Switch({ on, label, testId, describedBy, onToggle, disabled = false, tip, ariaDisabled = false, compact = false, children }: {
  on: boolean
  label: string
  testId: string
  describedBy?: string
  onToggle: () => void
  /** Shows the state and cannot change it (the Leftover switch at area scope). */
  disabled?: boolean
  /** The instant tooltip (`data-tip`). */
  tip?: string
  /** Dimmed and inert but still focusable and described (`aria-disabled`): the Leftover switch of a list at area scope. */
  ariaDisabled?: boolean
  /** Fits and centres in a 30px column (a line of the Sources list). */
  compact?: boolean
  children?: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={children ? undefined : label}
      aria-describedby={describedBy}
      aria-disabled={ariaDisabled || undefined}
      data-tip={tip}
      data-testid={testId}
      disabled={disabled}
      onClick={ariaDisabled ? undefined : onToggle}
      className={`inline-flex items-center rounded py-0.5 text-[11px] leading-4 text-gray-300 outline-none hover:text-gray-100 focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-50 disabled:hover:text-gray-300 ${compact ? 'w-[30px] justify-center px-0' : 'gap-1.5 px-1'} ${ariaDisabled ? 'opacity-40' : ''}`}
    >
      {children}
      <span aria-hidden="true" className={`relative inline-block w-6 h-3 rounded-full ${on ? 'bg-teal-600' : 'bg-gray-600'}`}>
        <span className={`absolute top-0.5 w-2 h-2 rounded-full bg-gray-100 ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
