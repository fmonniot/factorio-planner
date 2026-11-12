// The small controls the Comes from control and the Sources list share.

/** A small bordered button: the Sources… button, the move buttons. */
export const MINI_BUTTON_CLASS =
  'bg-gray-900 border border-gray-700 rounded px-1.5 text-[11px] leading-4 text-gray-300 outline-none hover:border-gray-500 focus-visible:ring-2 focus-visible:ring-teal-400 aria-disabled:opacity-40 aria-disabled:hover:border-gray-700'

/**
 * A switch (`role="switch"`) with the track the Comes from control draws. `children` is its visible name; without it the
 * switch is named by `label` (a line of the Sources list already shows the name).
 */
export function Switch({ on, label, testId, describedBy, onToggle, children }: {
  on: boolean
  label: string
  testId: string
  describedBy?: string
  onToggle: () => void
  children?: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={children ? undefined : label}
      aria-describedby={describedBy}
      data-testid={testId}
      onClick={onToggle}
      className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] leading-4 text-gray-300 outline-none hover:text-gray-100 focus-visible:ring-2 focus-visible:ring-teal-400"
    >
      {children}
      <span aria-hidden="true" className={`relative inline-block w-6 h-3 rounded-full ${on ? 'bg-teal-600' : 'bg-gray-600'}`}>
        <span className={`absolute top-0.5 w-2 h-2 rounded-full bg-gray-100 ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
