import type { ProductChangeEffect } from '../../store/connections'
import type { RateUnit } from '../../store/uiStore'
import { fmtRate } from './ItemTile'

export type ProductChange = 'add' | 'remove'

export function possessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`
}

/** Heading of the product change confirmation. */
export function productChangeTitle(change: ProductChange, itemName: string, blockName: string): string {
  if (change === 'add') return `Make ${itemName} a product of ${blockName}?`
  return `Remove ${itemName} from ${possessive(blockName)} products?`
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
    case 'source-receives':
      return `${head} It would request it instead, but this block receives ${itemName} itself, so it will still only take what is left over.`
    default:
      return `${head} It will request it instead, so its needs will drive how much this block makes.`
  }
}
