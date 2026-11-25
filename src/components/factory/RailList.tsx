import type { ReactNode } from 'react'

/**
 * A list of lines hung on a vertical rail with an arrow at one end: `head` for what leaves the item (the arrow opens the list),
 * `foot` for what comes into it (the arrow closes it). Generic: it knows nothing about what the lines say.
 */
export function RailList({ arrow, label, testId, children }: {
  arrow: 'head' | 'foot'
  /** The accessible name of the list. */
  label: string
  testId?: string
  children: ReactNode
}) {
  const head = arrow === 'head'
  const arrowRow = (
    <li aria-hidden="true" className="relative flex h-3 items-center pl-0.5 text-gray-500">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3.5l3 3 3-3" />
      </svg>
    </li>
  )
  return (
    <ul role="list" aria-label={label} data-testid={testId} data-arrow={arrow} className="relative my-1 ml-[30px]">
      <span aria-hidden="true" className={`absolute left-2 w-0.5 bg-gray-700 ${head ? 'top-1.5 bottom-2.5' : 'top-2.5 bottom-1.5'}`} />
      {head && arrowRow}
      {children}
      {!head && arrowRow}
    </ul>
  )
}

/** One line of a `RailList`: an icon on the rail, a label with an optional detail, and a right-aligned rate. */
export function RailLine({ icon, label, detail, rate, tip, testId = 'rail-line', labelTestId = 'rail-line-label', rateTestId = 'rail-line-rate', attrs }: {
  icon: ReactNode
  label: ReactNode
  /** Secondary text after the label, greyed. */
  detail?: ReactNode
  rate: ReactNode
  /** The instant tooltip of the line. */
  tip: string
  testId?: string
  labelTestId?: string
  rateTestId?: string
  /** Extra attributes on the line, such as `data-kind`. */
  attrs?: Record<string, string | undefined>
}) {
  return (
    <li data-testid={testId} data-tip={tip} {...attrs} className="relative flex h-5 items-center gap-1.5 rounded px-0 text-[11px] text-gray-300 hover:bg-[#1a2333]">
      <span aria-hidden="true" className="relative z-10 flex w-3.5 shrink-0 justify-center bg-gray-900">{icon}</span>
      <span className="flex min-w-0 flex-1 items-center">
        <span data-testid={labelTestId} className="truncate">{label}</span>
        {detail !== undefined && <span className="ml-1.5 truncate text-gray-400">{detail}</span>}
      </span>
      <span data-testid={rateTestId} className="w-11 shrink-0 text-right font-mono tabular-nums text-gray-200">{rate}</span>
    </li>
  )
}
