import type { ReactNode } from 'react'
import type { Item } from '../../data/types'
import { ELECTRICITY_ITEM_ID } from '../../data/electricity'
import { useUiStore } from '../../store/uiStore'
import { IconChip, PinBadge, type ChipTone } from './IconChip'
import { fmtChipQuantity, fmtItemRateText } from './ItemTile'

export type ItemChipVariant = Exclude<ChipTone, 'neutral'>

interface ItemChipProps {
  item: Item | undefined
  /** Always items/sec; shown in the rate unit of the uiStore. */
  ratePerSec: number
  variant: ItemChipVariant
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  title?: string
  /** Pre-formatted temperature requirement (e.g. "≥95°C"), shown in the top-left corner. */
  temperature?: string
  /** The source rule marker (`SourceRuleMarker.tsx`) of an ingredient whose item has a rule with an effect. */
  marker?: ReactNode
  /** The product's rate is pinned. */
  pinned?: boolean
  /** The chip is the fuel a burner row burns: marked with `data-fuel`. */
  fuel?: boolean
}

/** An item and its rate in the production table: an `IconChip` with the rate in the bottom-right corner. */
export function ItemChip({ item, ratePerSec, variant, onClick, onContextMenu, title, temperature, marker, pinned, fuel }: ItemChipProps) {
  const unit = useUiStore(s => s.rateUnit)
  // Energy is always in power units, which the rate unit does not tell; item rates follow the toolbar's unit.
  const quantity = fmtChipQuantity(item?.id, ratePerSec, unit)
  const baseTitle = title ?? item?.name
  // The corner shows the number only: the title carries the full rate with its unit.
  const chipTitle = baseTitle ? `${baseTitle} — ${fmtItemRateText(item?.id, ratePerSec, unit)}` : baseTitle
  const electricityNoIcon = item?.id === ELECTRICITY_ITEM_ID && !item?.iconPath

  return (
    <IconChip
      iconPath={item?.iconPath || undefined}
      alt={item?.name ?? '?'}
      fallback={electricityNoIcon ? '⚡' : (item?.name ?? '?')}
      quantity={quantity}
      tone={variant}
      corner={temperature && <span data-testid="item-tile-temperature">{temperature}</span>}
      badges={pinned ? <PinBadge /> : undefined}
      marker={marker}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={chipTitle}
      data-variant={variant}
      data-fuel={fuel ? 'true' : undefined}
    />
  )
}
