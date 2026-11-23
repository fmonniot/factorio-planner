import type { ProductChangeEffect } from '../../store/connections'
import type { RateUnit } from '../../store/uiStore'
import { fmtItemRateText } from './ItemTile'

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
export function productChangeRateText(itemId: string, rate: number | undefined, unit: RateUnit): string {
  if (rate === undefined) return '—'
  return fmtItemRateText(itemId, rate / 60, unit)
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

/** Warning line when the block already receives the item it is given as a product. */
export function receivedLine(sourceNames: string[], itemName: string): string {
  if (sourceNames.length === 0) return ''
  const from = sourceNames.length > 1 ? `${sourceNames.slice(0, -1).join(', ')} and ${sourceNames[sourceNames.length - 1]}` : sourceNames[0]
  return `This block already receives ${itemName} from ${from}. Requests for ${itemName} to this block will be ignored: it only gives what it has left over. Remove the incoming connection first if you want it to be requested.`
}
