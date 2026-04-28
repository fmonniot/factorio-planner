import type { Item } from '../../data/types'
import { iconUrl } from '../../utils/iconUrl'
import { useUiStore } from '../../store/uiStore'

// ---------------------------------------------------------------------------
// Rate formatting (shared across factory components)
// ---------------------------------------------------------------------------

export function fmtRate(ratePerSec: number, unit: 'sec' | 'min'): string {
  const v = unit === 'min' ? ratePerSec * 60 : ratePerSec
  if (v >= 100) return v.toFixed(0)
  if (v >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

// ---------------------------------------------------------------------------
// ItemTile
// ---------------------------------------------------------------------------

export type ItemTileVariant = 'product' | 'byproduct' | 'ingredient' | 'electricity'

interface ItemTileProps {
  /** Item data for icon/label. Pass undefined for electricity (uses ⚡ symbol). */
  item: Item | undefined
  /** Always expressed as items/sec internally; displayed according to uiStore rateUnit. */
  ratePerSec: number
  variant: ItemTileVariant
  onClick?: () => void
  title?: string
}

const variantClasses: Record<ItemTileVariant, string> = {
  product:     'bg-gray-700 text-gray-100 border-t-2 border-teal-500',
  byproduct:   'bg-red-950 text-red-300 border-t-2 border-red-500',
  ingredient:  'bg-green-950 text-green-300 border-t-2 border-green-600',
  electricity: 'bg-cyan-950 text-cyan-300 border-t-2 border-yellow-500',
}

export function ItemTile({ item, ratePerSec, variant, onClick, title }: ItemTileProps) {
  const unit = useUiStore(s => s.rateUnit)
  const label = fmtRate(ratePerSec, unit)
  const unitLabel = unit === 'min' ? '/m' : '/s'
  const cls = variantClasses[variant]

  const inner = (
    <>
      {variant === 'electricity' ? (
        <span className="text-base leading-none">⚡</span>
      ) : item?.iconPath ? (
        <img
          src={iconUrl(item.iconPath)}
          alt={item.name}
          className="w-7 h-7 object-contain shrink-0"
        />
      ) : (
        <span className="text-xs truncate max-w-[4rem]" title={item?.name ?? '?'}>
          {item?.name ?? '?'}
        </span>
      )}
      <span className="text-[10px] font-mono tabular-nums leading-none">
        {label}
        <span className="opacity-60">{unitLabel}</span>
      </span>
    </>
  )

  const baseClass = `inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${cls}`

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title ?? item?.name}
        className={`${baseClass} hover:brightness-125 cursor-pointer`}
      >
        {inner}
      </button>
    )
  }

  return (
    <span title={title ?? item?.name} className={baseClass}>
      {inner}
    </span>
  )
}
