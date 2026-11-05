import type { GameData } from '../../../data/types'
import { withinHorizon } from '../../../data/horizon'
import { IconChip } from '../IconChip'
import { BeyondTag } from './PanelParts'
import { Picker, PickerRow } from '../Picker'
import { PickerTrigger } from '../PickerTrigger'

type Module = GameData['modules'][string]

/**
 * One button per module slot. A slot opens a list of the modules it accepts (and "Empty slot");
 * the caller decides what choosing does. Slots past `slotCount` are overflow (more modules than slots)
 * and drawn with an amber ring.
 */
export function ModuleSlotRow({ slots, slotCount, options, gameData, moduleIds, onSelect, testIdPrefix = 'module', label }: {
  slots: readonly (string | undefined)[]
  slotCount: number
  /** The modules a slot may take (already filtered by the machine, the recipe and the research horizon). */
  options: readonly Module[]
  gameData: GameData
  /** The research horizon's module ids; null = no limit. */
  moduleIds: ReadonlySet<string> | null
  onSelect: (index: number, moduleId: string | undefined) => void
  testIdPrefix?: string
  /** Accessible name prefix of the slot buttons. */
  label: string
}) {
  const beyond = slots.some(id => id !== undefined && !withinHorizon(moduleIds, id))

  return (
    <div>
      <div className="flex flex-wrap gap-1.5" data-testid={`${testIdPrefix}-slots`}>
        {slots.map((id, i) => {
          const mod = id ? gameData.modules[id] : undefined
          const overflow = i >= slotCount
          const outside = id !== undefined && !withinHorizon(moduleIds, id)
          return (
            <PickerTrigger
              key={i}
              trigger={({ open, toggle }) => (
                <IconChip
                  size="entity"
                  empty={id === undefined}
                  iconPath={mod?.iconPath || undefined}
                  alt={mod?.name ?? id ?? 'empty slot'}
                  fallback={id !== undefined && !mod ? '?' : undefined}
                  warn={overflow || outside || (id !== undefined && !mod)}
                  onClick={toggle}
                  title={id === undefined ? 'Empty slot' : (mod?.name ?? `Unknown module "${id}"`) + (overflow ? ' (more modules than slots)' : '')}
                  aria-label={`${label} ${i + 1}: ${id === undefined ? 'empty' : (mod?.name ?? id)}`}
                  aria-expanded={open}
                  data-testid={`${testIdPrefix}-slot`}
                  data-slot-index={i}
                  data-overflow={overflow ? 'true' : undefined}
                />
              )}
            >
              {close => (
                <Picker heading="Module" onClose={close}>
                  <PickerRow
                    name="Empty slot"
                    selected={id === undefined}
                    data-testid={`${testIdPrefix}-option-empty`}
                    onClick={() => { onSelect(i, undefined); close() }}
                  />
                  {options.map(m => (
                    <PickerRow
                      key={m.id}
                      name={m.name}
                      iconPath={m.iconPath || undefined}
                      selected={m.id === id}
                      data-testid={`${testIdPrefix}-option`}
                      data-module-id={m.id}
                      onClick={() => { onSelect(i, m.id); close() }}
                    />
                  ))}
                </Picker>
              )}
            </PickerTrigger>
          )
        })}
      </div>
      {beyond && <BeyondTag className="block mt-1" />}
    </div>
  )
}
