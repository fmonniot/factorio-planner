import type { GameData } from '../../data/types'
import { Picker, PickerRow, PickerEmpty } from './Picker'

type Module = GameData['modules'][string]

/**
 * The fill-all picker behind the dashed `+` chips: lists the modules a choice may use and reports the chosen id.
 * The caller decides what choosing does (fill every machine slot, fill a new or existing beacon) and which modules fit.
 */
export function ModuleFillPicker({ heading, options, onPick, onClose }: {
  heading: string
  options: readonly Module[]
  onPick: (moduleId: string) => void
  onClose: () => void
}) {
  return (
    <Picker heading={heading} onClose={onClose} data-kind="module-fill">
      {options.length === 0 && <PickerEmpty data-testid="module-fill-empty">No module fits here within the research horizon.</PickerEmpty>}
      {options.map(m => (
        <PickerRow
          key={m.id}
          name={m.name}
          iconPath={m.iconPath || undefined}
          data-testid="module-fill-option"
          data-module-id={m.id}
          onClick={() => { onPick(m.id); onClose() }}
        />
      ))}
    </Picker>
  )
}
