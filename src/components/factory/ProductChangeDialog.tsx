import type { ProductChangeEffect } from '../../store/connections'
import type { RateUnit } from '../../store/uiStore'
import { Modal } from '../Modal'
import {
  productChangeLine,
  productChangeRateText,
  productChangeTitle,
  type ProductChange,
} from './productChangeText'

interface ProductChangeDialogProps {
  change: ProductChange
  itemId: string
  itemName: string
  blockName: string
  effects: ProductChangeEffect[]
  rateUnit: RateUnit
  onCancel: () => void
  onConfirm: () => void
}

const SECONDARY_BUTTON = 'text-xs bg-gray-800 text-gray-300 hover:text-gray-100 border border-gray-600 rounded px-3 py-1'

/** Confirmation shown when adding or removing a product changes how other blocks' connections behave. */
export function ProductChangeDialog({
  change,
  itemId,
  itemName,
  blockName,
  effects,
  rateUnit,
  onCancel,
  onConfirm,
}: ProductChangeDialogProps) {
  const add = change === 'add'
  return (
    <Modal onClose={onCancel} className="p-4 w-[28rem] text-sm">
      <div data-testid="product-change-confirm">
        <h2 className="font-semibold text-gray-100 mb-2">{productChangeTitle(change, itemName, blockName)}</h2>
        <ul className="list-disc pl-5 space-y-1 text-gray-300 mb-3">
          {effects.map(effect => (
            <li key={effect.connectionId} data-testid="product-change-effect">
              {productChangeLine(change, effect, itemName, productChangeRateText(itemId, effect.rate, rateUnit))}
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>Cancel</button>
          <button
            type="button"
            onClick={onConfirm}
            className={`text-xs text-white rounded px-3 py-1 ${add ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-red-600 hover:bg-red-500'}`}
          >
            {add ? 'Make it a product' : 'Remove product'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
