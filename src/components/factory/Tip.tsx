// The black tooltip of the summary bar, shared by the Comes from control and the Sources list.

/** Where a tooltip sits against its control: the first control of a row opens rightwards, the last leftwards. */
export type TipAlign = 'start' | 'center' | 'end'

const TIP_ALIGN: Record<TipAlign, string> = {
  start: 'left-0',
  center: 'left-1/2 -translate-x-1/2',
  end: 'right-0',
}

/**
 * The black tooltip of the summary bar, for a control: shown on hover and on keyboard focus (not on the focus
 * a click leaves), and the control's accessible description.
 */
export function Tip({ id, align, hoverOnly = false, children }: {
  id: string
  align: TipAlign
  /** Shown on hover only: the keyboard gets the text another way (the Sources list's help line). */
  hoverOnly?: boolean
  children: string
}) {
  return (
    <span
      id={id}
      role="tooltip"
      className={`hidden group-hover:block ${hoverOnly ? '' : 'group-has-[:focus-visible]:block '}w-max max-w-[240px] absolute z-50 bottom-[calc(100%+6px)] ${TIP_ALIGN[align]} bg-black text-gray-100 text-[11px] leading-normal font-normal text-left whitespace-normal border border-gray-700 rounded px-2 py-1 pointer-events-none shadow-lg shadow-black/60`}
    >
      {children}
    </span>
  )
}

