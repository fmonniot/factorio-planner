import type { GameData } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { IconChip } from './IconChip'
import { fmtChipQuantity, fmtItemRate } from './ItemTile'

interface ChipProps {
  itemId: string
  rate: number
  boundary: boolean
  /** The other end in words ("from Oil"); the title falls back to the boundary text without it. */
  otherEnd?: string
  direction: 'receives' | 'sends'
  items: GameData['items']
  rateUnit: RateUnit
}

export function FlowChip({ itemId, rate, boundary, otherEnd, direction, items, rateUnit }: ChipProps) {
  const item = items[itemId]
  const name = item?.name ?? itemId
  const { value: amount, unit: unitLabel } = fmtItemRate(itemId, rate / 60, rateUnit)
  const outside = direction === 'receives' ? ' — from outside the block' : ' — leaves the block'
  const end = otherEnd ? ` — ${otherEnd}` : boundary ? outside : ''
  const title = `${name}: ${amount}${unitLabel}${end}`
  return (
    <IconChip
      iconPath={item?.iconPath || undefined}
      alt={name}
      fallback={name}
      quantity={fmtChipQuantity(itemId, rate / 60, rateUnit)}
      tone={direction === 'receives' ? 'ingredient' : 'product'}
      title={title}
      data-item-id={itemId}
      data-direction={direction}
      data-boundary={boundary ? 'true' : 'false'}
    />
  )
}
