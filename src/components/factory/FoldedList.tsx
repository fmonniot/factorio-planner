import { useId, useState, type ReactNode } from 'react'

/** A folded list shows this many entries until "Show all" is pressed. */
export const FOLD_CAP = 6

/** A list that shows its first `cap` entries and a button to show them all. `testId` names the list; the button is `${testId}-toggle`. */
export function FoldedList<T>({ items, cap = FOLD_CAP, testId, className, renderItem }: {
  items: readonly T[]
  cap?: number
  testId: string
  className?: string
  renderItem: (item: T, index: number) => ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const capped = items.length > cap
  const shown = capped && !expanded ? items.slice(0, cap) : items
  return (
    <>
      <ul id={listId} data-testid={testId} className={className}>
        {shown.map(renderItem)}
      </ul>
      {capped && (
        <button
          type="button"
          data-testid={`${testId}-toggle`}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded(e => !e)}
          className="mt-1.5 w-full min-h-7 px-2 rounded border border-gray-600 text-[11px] text-gray-300 hover:bg-gray-800 hover:text-gray-100"
        >
          {expanded ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </>
  )
}
