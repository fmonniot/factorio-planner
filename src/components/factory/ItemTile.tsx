import type { Item } from '../../data/types'
import { Icon } from '../Icon'
import { useUiStore } from '../../store/uiStore'

// ---------------------------------------------------------------------------
// Rate formatting (shared across factory components)
// ---------------------------------------------------------------------------

// eslint-disable-next-line react-refresh/only-export-components
export function fmtRate(ratePerSec: number, unit: 'sec' | 'min'): string {
  const v = unit === 'min' ? ratePerSec * 60 : ratePerSec
  if (v >= 100) return v.toFixed(0)
  if (v >= 10) return v.toFixed(1)
  return v.toFixed(2)
}

// eslint-disable-next-line react-refresh/only-export-components
export function fmtPower(kw: number): { value: string; unit: string } {
  if (kw < 1) return { value: (kw * 1000).toFixed(0), unit: 'W' }
  if (kw < 1000) return { value: kw.toFixed(1), unit: 'kW' }
  if (kw < 1_000_000) return { value: (kw / 1000).toFixed(1), unit: 'MW' }
  return { value: (kw / 1_000_000).toFixed(1), unit: 'GW' }
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
  const cls = variantClasses[variant]

  const isPower = variant === 'electricity'
  const power = isPower ? fmtPower(ratePerSec) : null
  const label = isPower ? power!.value : fmtRate(ratePerSec, unit)
  const unitLabel = isPower ? power!.unit : unit === 'min' ? '/m' : '/s'

  const inner = (
    <>
      {isPower ? (
        <span className="text-base leading-none">⚡</span>
      ) : item?.iconPath ? (
        <Icon
          iconPath={item.iconPath}
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
