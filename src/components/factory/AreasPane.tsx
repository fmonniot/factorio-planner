import { useState } from 'react'
import type { GameData } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { Icon } from '../Icon'
import { fmtRate } from './ItemTile'
import type { AreaRow } from './areaRows'

interface AreasPaneProps {
  rows: AreaRow[]
  items: GameData['items']
  rateUnit: RateUnit
}

interface ChipProps {
  itemId: string
  rate: number
  boundary: boolean
  direction: 'receives' | 'sends'
  items: GameData['items']
  rateUnit: RateUnit
  selectedItemId: string | null
  onSelect: (itemId: string) => void
}

function FlowChip({ itemId, rate, boundary, direction, items, rateUnit, selectedItemId, onSelect }: ChipProps) {
  const item = items[itemId]
  const name = item?.name ?? itemId
  const unitLabel = rateUnit === 'min' ? '/m' : '/s'
  const amount = fmtRate(rate / 60, rateUnit)
  const outside = direction === 'receives' ? ' — from outside the block' : ' — leaves the block'
  const selected = selectedItemId === itemId
  const dimmed = selectedItemId !== null && !selected
  return (
    <button
      type="button"
      data-item-id={itemId}
      data-direction={direction}
      data-boundary={boundary ? 'true' : 'false'}
      aria-pressed={selected}
      title={`${name}: ${amount}${unitLabel}${boundary ? outside : ''}`}
      onClick={() => onSelect(itemId)}
      className={`inline-flex items-center gap-1 h-6 px-1 rounded border text-[10px] font-mono tabular-nums ${
        boundary ? 'border-dashed' : 'border-solid'
      } ${selected ? 'border-teal-400 bg-teal-500/20 text-teal-200' : 'border-gray-600 text-gray-300 hover:border-gray-400'} ${
        dimmed ? 'opacity-40' : ''
      }`}
    >
      {item?.iconPath ? (
        <Icon iconPath={item.iconPath} alt={name} className="w-4 h-4 object-contain shrink-0" />
      ) : (
        <span className="truncate max-w-[4rem]">{name}</span>
      )}
      <span>
        {amount}
        <span className="opacity-60">{unitLabel}</span>
      </span>
    </button>
  )
}

// What each area of the block receives from the others and sends to them. Selecting a chip lights
// up the same item in every area: who sends it and who receives it. View state only.
export function AreasPane({ rows, items, rateUnit }: AreasPaneProps) {
  const [open, setOpen] = useState(true)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const select = (itemId: string) => setSelectedItemId(cur => (cur === itemId ? null : itemId))

  return (
    <section aria-label="Areas" className="border border-gray-700 rounded-md mx-3 mb-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-[0.06em] text-gray-400 hover:text-gray-200 text-left"
      >
        <span aria-hidden>{open ? '▼' : '▶'}</span>
        <span>Areas</span>
        <span className="tabular-nums">· {rows.length}</span>
      </button>
      {open && (
        <ul className="max-h-[120px] overflow-y-auto px-2 pb-2 flex flex-col gap-1">
          {rows.map(row => (
            <li key={row.areaId} aria-label={row.name} className="flex items-start gap-2 text-xs">
              <span className="w-28 shrink-0 truncate text-gray-200 leading-6" title={row.name}>{row.name}</span>
              <div className="flex flex-wrap items-center gap-1 min-w-0">
                {row.receives.length > 0 && <span className="text-[10px] text-gray-500">in</span>}
                {row.receives.map(f => (
                  <FlowChip
                    key={`in-${f.itemId}`}
                    {...f}
                    direction="receives"
                    items={items}
                    rateUnit={rateUnit}
                    selectedItemId={selectedItemId}
                    onSelect={select}
                  />
                ))}
                {row.sends.length > 0 && <span className="text-[10px] text-gray-500">out</span>}
                {row.sends.map(f => (
                  <FlowChip
                    key={`out-${f.itemId}`}
                    {...f}
                    direction="sends"
                    items={items}
                    rateUnit={rateUnit}
                    selectedItemId={selectedItemId}
                    onSelect={select}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
