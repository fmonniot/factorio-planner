import type { RateUnit } from '../../store/uiStore'
import { fmtEnergyText, fmtRate } from './ItemTile'

// Electricity and heat (`energy`) are shown in power units whatever the rate unit, unit included in
// the text; every other item is a unit-less number that follows the rate unit.

/** items/min as a shown rate; a value that rounds to zero reads "<0.01" ("<1W" for energy). */
export function fmtAmount(perMin: number, unit: RateUnit, energy: boolean): string {
  if (energy) {
    const s = fmtEnergyText(Math.abs(perMin) / 60)
    return s === '0W' ? '<1W' : s
  }
  const s = fmtRate(Math.abs(perMin) / 60, unit)
  return s === '0.00' ? '<0.01' : s
}

/** A signed cell value: "+" for what an area sends, U+2212 for what it receives. */
export function fmtSigned(perMin: number, unit: RateUnit, energy: boolean): string {
  return `${perMin < 0 ? '−' : '+'}${fmtAmount(perMin, unit, energy)}`
}

export function unitSuffix(unit: RateUnit): string {
  return unit === 'min' ? '/m' : '/s'
}

/** `fmtAmount` with its unit: "12.0/m" for an item, "10.0MW" for energy. */
export function fmtAmountUnit(perMin: number, unit: RateUnit, energy: boolean): string {
  return energy ? fmtAmount(perMin, unit, true) : fmtAmount(perMin, unit, false) + unitSuffix(unit)
}

/** `fmtSigned` with its unit. */
export function fmtSignedUnit(perMin: number, unit: RateUnit, energy: boolean): string {
  return energy ? fmtSigned(perMin, unit, true) : fmtSigned(perMin, unit, false) + unitSuffix(unit)
}

/** What an area trades in one direction: "12.0/m + 10.0MW", "" when nothing moves. */
export function tradeRateText(items: number, energy: number, unit: RateUnit): string {
  const parts: string[] = []
  if (items > 0) parts.push(fmtAmountUnit(items, unit, false))
  if (energy > 0) parts.push(fmtAmountUnit(energy, unit, true))
  return parts.join(' + ')
}
