import { useRef, useState } from 'react'
import type { GameData } from '../../../data/types'
import { withinHorizon } from '../../../data/horizon'
import { Icon } from '../../Icon'
import { IconChip } from '../IconChip'
import { BeyondTag } from './PanelParts'
import { useDismiss } from './useDismiss'

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
  const [open, setOpen] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, open !== null, () => setOpen(null))
  const beyond = slots.some(id => id !== undefined && !withinHorizon(moduleIds, id))

  return (
    <div ref={ref}>
      <div className="flex flex-wrap gap-1.5" data-testid={`${testIdPrefix}-slots`}>
        {slots.map((id, i) => {
          const mod = id ? gameData.modules[id] : undefined
          const overflow = i >= slotCount
          const outside = id !== undefined && !withinHorizon(moduleIds, id)
          return (
            <IconChip
              key={i}
              size="entity"
              empty={id === undefined}
              iconPath={mod?.iconPath || undefined}
              alt={mod?.name ?? id ?? 'empty slot'}
              fallback={id !== undefined && !mod ? '?' : undefined}
              warn={overflow || outside || (id !== undefined && !mod)}
              onClick={() => setOpen(open === i ? null : i)}
              title={id === undefined ? 'Empty slot' : (mod?.name ?? `Unknown module "${id}"`) + (overflow ? ' (more modules than slots)' : '')}
              aria-label={`${label} ${i + 1}: ${id === undefined ? 'empty' : (mod?.name ?? id)}`}
              aria-expanded={open === i}
              data-testid={`${testIdPrefix}-slot`}
              data-slot-index={i}
              data-overflow={overflow ? 'true' : undefined}
            />
          )
        })}
      </div>
      {open !== null && (
        <div className="mt-1.5 bg-gray-800 border border-gray-700 rounded p-1 max-h-48 overflow-y-auto space-y-0.5">
          <button
            type="button"
            data-testid={`${testIdPrefix}-option-empty`}
            onClick={() => { onSelect(open, undefined); setOpen(null) }}
            className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 ${slots[open] === undefined ? 'text-teal-400' : 'text-gray-300'}`}
          >
            Empty slot
          </button>
          {options.map(m => (
            <button
              key={m.id}
              type="button"
              data-testid={`${testIdPrefix}-option`}
              data-module-id={m.id}
              onClick={() => { onSelect(open, m.id); setOpen(null) }}
              className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 flex items-center gap-1.5 ${m.id === slots[open] ? 'text-teal-400' : 'text-gray-300'}`}
            >
              {m.iconPath && <Icon iconPath={m.iconPath} alt="" className="w-5 h-5 object-contain shrink-0" />}
              {m.name}
            </button>
          ))}
        </div>
      )}
      {beyond && <BeyondTag className="block mt-1" />}
    </div>
  )
}
