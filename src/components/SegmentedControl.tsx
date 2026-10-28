import { createContext, useContext, type ButtonHTMLAttributes, type ReactNode } from 'react'

// ---------------------------------------------------------------------------
// A segmented control: a dark track holding one pill per option, the pressed one filled.
// ---------------------------------------------------------------------------

export type SegmentedSize = 'xs' | 'sm' | 'md'

const TRACK: Record<SegmentedSize, string> = {
  xs: 'p-0.5 gap-0.5 rounded-md',
  sm: 'p-0.5 gap-0.5 rounded-md',
  md: 'p-[3px] gap-1 rounded-lg',
}

const PILL: Record<SegmentedSize, string> = {
  xs: 'h-5 px-1.5 rounded text-[10px] font-normal',
  sm: 'h-6 px-2 rounded text-xs',
  md: 'h-7 px-2.5 rounded-md text-[13px]',
}

const SizeContext = createContext<SegmentedSize>('md')

interface SegmentedProps {
  /** Accessible name of the group. Leave it out when the control sits in a group that already has one. */
  label?: string
  size?: SegmentedSize
  children: ReactNode
}

export function Segmented({ label, size = 'md', children }: SegmentedProps) {
  return (
    <SizeContext.Provider value={size}>
      <div
        role={label !== undefined ? 'group' : undefined}
        aria-label={label}
        className={`inline-flex flex-wrap items-center bg-gray-950 border border-gray-700 ${TRACK[size]}`}
      >
        {children}
      </div>
    </SizeContext.Provider>
  )
}

interface SegmentProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'className'> {
  pressed: boolean
}

/**
 * One option. A plain button reports `aria-pressed`; as a `menuitemradio` it reports `aria-checked`
 * and shows its keyboard focus on any focus, like the other menu items.
 */
export function Segment({ pressed, children, ...rest }: SegmentProps) {
  const size = useContext(SizeContext)
  const inMenu = rest.role === 'menuitemradio'
  const state = inMenu ? { 'aria-checked': pressed } : { 'aria-pressed': pressed }
  const focus = inMenu ? 'focus:ring-1 focus:ring-inset focus:ring-teal-400' : 'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-teal-400'
  return (
    <button
      type="button"
      {...state}
      {...rest}
      className={`flex items-center gap-1.5 outline-none ${focus} ${PILL[size]} ${pressed ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}
    >
      {children}
    </button>
  )
}
