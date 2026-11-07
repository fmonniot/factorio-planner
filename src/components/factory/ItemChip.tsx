import type { Item, ItemSourcingMode } from '../../data/types'
import { ELECTRICITY_ITEM_ID, isEnergyItem } from '../../data/electricity'
import { useUiStore } from '../../store/uiStore'
import { IconChip, PinBadge, SourcingBadge, type ChipTone } from './IconChip'
import { fmtItemRate, fmtItemRateText } from './ItemTile'
import { itemSourcingLabel } from './itemSourcing'

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
  /** The block's sourcing mode for this item, when not the default; a `B` / `C` badge. */
  sourcing?: ItemSourcingMode
  /** The product's rate is pinned. */
  pinned?: boolean
  /** The chip is the fuel a burner row burns: marked with `data-fuel`. */
  fuel?: boolean
}

/** An item and its rate in the production table: an `IconChip` with the rate in the bottom-right corner. */
export function ItemChip({ item, ratePerSec, variant, onClick, onContextMenu, title, temperature, sourcing, pinned, fuel }: ItemChipProps) {
  const unit = useUiStore(s => s.rateUnit)
  const rate = fmtItemRate(item?.id, ratePerSec, unit)
  // Energy is always in power units, which the rate unit does not tell; item rates follow the toolbar's unit.
  const quantity = isEnergyItem(item?.id) ? rate.value + rate.unit : rate.value
  const baseTitle = title ?? item?.name
  const sourced = sourcing && baseTitle ? `${baseTitle} (${itemSourcingLabel(sourcing)})` : baseTitle
  // The corner shows the number only: the title carries the full rate with its unit.
  const chipTitle = sourced ? `${sourced} — ${fmtItemRateText(item?.id, ratePerSec, unit)}` : sourced
  const electricityNoIcon = item?.id === ELECTRICITY_ITEM_ID && !item?.iconPath

  return (
    <IconChip
      iconPath={item?.iconPath || undefined}
      alt={item?.name ?? '?'}
      fallback={electricityNoIcon ? '⚡' : (item?.name ?? '?')}
      quantity={quantity}
      tone={variant}
      corner={temperature && <span data-testid="item-tile-temperature">{temperature}</span>}
      badges={
        pinned || sourcing ? (
          <>
            {pinned && <PinBadge />}
            {sourcing && <SourcingBadge letter={sourcing === 'byproducts-first' ? 'B' : 'C'} mode={sourcing} />}
          </>
        ) : undefined
      }
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={chipTitle}
      data-variant={variant}
      data-fuel={fuel ? 'true' : undefined}
    />
  )
}
