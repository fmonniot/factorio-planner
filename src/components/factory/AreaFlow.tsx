import type { GameData } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { Icon } from '../Icon'
import { fmtItemRate } from './ItemTile'

interface ChipProps {
  itemId: string
  rate: number
  boundary: boolean
  direction: 'receives' | 'sends'
  items: GameData['items']
  rateUnit: RateUnit
}

export function FlowChip({ itemId, rate, boundary, direction, items, rateUnit }: ChipProps) {
  const item = items[itemId]
  const name = item?.name ?? itemId
  const { value: amount, unit: unitLabel } = fmtItemRate(itemId, rate / 60, rateUnit)
  const outside = direction === 'receives' ? ' — from outside the block' : ' — leaves the block'
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
