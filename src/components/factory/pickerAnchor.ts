import { createContext, useContext, type RefObject } from 'react'

/** The element a picker opens from (the trigger's wrapper); `PickerTrigger` provides it, `Picker` reads it. */
export const PickerAnchorContext = createContext<RefObject<HTMLElement | null> | null>(null)

export function usePickerAnchor(): RefObject<HTMLElement | null> | null {
  return useContext(PickerAnchorContext)
}
