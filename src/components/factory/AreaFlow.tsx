import type { GameData } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { Icon } from '../Icon'
import { fmtRate } from './ItemTile'
import type { AreaRow } from './areaRows'

interface ChipProps {
  itemId: string
  rate: number
  boundary: boolean
  direction: 'receives' | 'sends'
  items: GameData['items']
  rateUnit: RateUnit
  selectedItemId?: string | null
  /** Without it the chip is display-only (a span). */
  onSelect?: (itemId: string) => void
}

export function FlowChip({ itemId, rate, boundary, direction, items, rateUnit, selectedItemId = null, onSelect }: ChipProps) {
  const item = items[itemId]
  const name = item?.name ?? itemId
  const unitLabel = rateUnit === 'min' ? '/m' : '/s'
  const amount = fmtRate(rate / 60, rateUnit)
  const outside = direction === 'receives' ? ' — from outside the block' : ' — leaves the block'
  const selected = selectedItemId === itemId
  const dimmed = selectedItemId !== null && !selected
  const title = `${name}: ${amount}${unitLabel}${boundary ? outside : ''}`
  const content = (
    <>
      {item?.iconPath ? (
        <Icon iconPath={item.iconPath} alt={name} className="w-4 h-4 object-contain shrink-0" />
      ) : (
        <span className="truncate max-w-[4rem]">{name}</span>
      )}
      <span>
        {amount}
        <span className="opacity-60">{unitLabel}</span>
      </span>
    </>
  )
  if (!onSelect) {
    return (
      <span
        data-item-id={itemId}
        data-direction={direction}
        data-boundary={boundary ? 'true' : 'false'}
        title={title}
        className={`inline-flex items-center gap-1 h-6 px-1 rounded border text-[10px] font-mono tabular-nums border-gray-600 text-gray-300 ${
          boundary ? 'border-dashed' : ''
        }`}
      >
        {content}
      </span>
    )
  }
  return (
    <button
      type="button"
      data-item-id={itemId}
      data-direction={direction}
      data-boundary={boundary ? 'true' : 'false'}
      aria-pressed={selected}
      title={title}
      onClick={() => onSelect(itemId)}
      className={`inline-flex items-center gap-1 h-6 px-1 rounded border text-[10px] font-mono tabular-nums ${
        boundary ? 'border-dashed' : 'border-solid'
      } ${selected ? 'border-teal-400 bg-teal-500/20 text-teal-200' : 'border-gray-600 text-gray-300 hover:border-gray-400'} ${
        dimmed ? 'opacity-40' : ''
      }`}
    >
      {content}
    </button>
  )
}

interface AreaListItemProps {
  row: AreaRow
  items: GameData['items']
  rateUnit: RateUnit
  selectedItemId: string | null
  onSelect: (itemId: string) => void
  /** Makes the name a button (the plan-level list opens the area from it); without it the name is plain text. */
  onOpen?: () => void
  openTitle?: string
}

/** One area: its name, then what it receives and sends as chips. */
export function AreaListItem({ row, items, rateUnit, selectedItemId, onSelect, onOpen, openTitle }: AreaListItemProps) {
  return (
    <li aria-label={row.name} className="flex items-start gap-2 text-xs">
      {onOpen ? (
        <button
          type="button"
          title={openTitle}
          onClick={onOpen}
          className="w-28 shrink-0 truncate text-left text-gray-200 hover:text-white hover:underline leading-6"
        >
          {row.name}
        </button>
      ) : (
        <span className="w-28 shrink-0 truncate text-gray-200 leading-6" title={row.name}>{row.name}</span>
      )}
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
            onSelect={onSelect}
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
            onSelect={onSelect}
          />
        ))}
      </div>
    </li>
  )
}
