import type { ProductChangeEffect } from '../../store/connections'
import type { RateUnit } from '../../store/uiStore'
import { fmtRate } from './ItemTile'

export type ProductChange = 'add' | 'remove'

/** Heading of the product change confirmation. */
export function productChangeTitle(change: ProductChange, itemName: string, blockName: string): string {
  if (change === 'add') return `Make ${itemName} a product of ${blockName}?`
  const possessive = blockName.endsWith('s') ? `${blockName}'` : `${blockName}'s`
  return `Remove ${itemName} from ${possessive} products?`
}

/** A delivered rate for the dialog, e.g. `30.0/m`; `—` without a flow. */
export function productChangeRateText(rate: number | undefined, unit: RateUnit): string {
  if (rate === undefined) return '—'
  return `${fmtRate(rate / 60, unit)}${unit === 'min' ? '/m' : '/s'}`
}

/** What one affected connection will do once the change is confirmed. */
export function productChangeLine(
  change: ProductChange,
  effect: ProductChangeEffect,
  itemName: string,
  rateText: string,
): string {
  const consumer = effect.consumerName
  if (change === 'remove') {
    return `${consumer} requests ${itemName} from this block (${rateText}). It will only take what is left over and no longer drive this block.`
  }
  const head = `${consumer} takes existing ${itemName} from this block (${rateText}).`
  switch (effect.blocker) {
    case 'request-loop':
      return `${head} It would request it instead, but that closes a cycle of requests: every request in the cycle will only take what is left over.`
    case 'source-receives':
      return `${head} It would request it instead, but this block receives ${itemName} itself, so it will still only take what is left over.`
    default:
      return `${head} It will request it instead, so its needs will drive how much this block makes.`
  }
}
