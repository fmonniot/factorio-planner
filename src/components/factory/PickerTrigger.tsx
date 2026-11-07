import { useRef, useState, type ReactNode } from 'react'
import { PickerAnchorContext } from './pickerAnchor'

/**
 * A trigger plus the picker it opens. It owns the open flag, so the picker is closed whenever this component (re)mounts
 * and never leaks between triggers. `trigger` renders the button (call `toggle` from its click); `children` renders the
 * `Picker` (call `close` when a choice is made). The wrapper is the picker's anchor: presses on it do not count as
 * "outside", so a press on the trigger just toggles.
 */
export function PickerTrigger({ trigger, children }: {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  return (
    <span ref={anchor} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      {open && (
        <PickerAnchorContext.Provider value={anchor}>
          {children(() => setOpen(false))}
        </PickerAnchorContext.Provider>
      )}
    </span>
  )
}
