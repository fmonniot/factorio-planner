import type { RateUnit } from '../../store/uiStore'
import { fmtRate } from './ItemTile'

/** items/min as a shown rate; a value that rounds to zero reads "<0.01". */
export function fmtAmount(perMin: number, unit: RateUnit): string {
  const s = fmtRate(Math.abs(perMin) / 60, unit)
  return s === '0.00' ? '<0.01' : s
}

/** A signed cell value: "+" for what an area sends, U+2212 for what it receives. */
export function fmtSigned(perMin: number, unit: RateUnit): string {
  return `${perMin < 0 ? '−' : '+'}${fmtAmount(perMin, unit)}`
}

export function unitSuffix(unit: RateUnit): string {
  return unit === 'min' ? '/m' : '/s'
}
