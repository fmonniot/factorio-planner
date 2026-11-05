import { isEnergyItem } from '../../data/electricity'
import type { RateUnit } from '../../store/uiStore'

// ---------------------------------------------------------------------------
// Rate formatting (shared across factory components)
// ---------------------------------------------------------------------------

export function fmtRate(ratePerSec: number, unit: 'sec' | 'min'): string {
  const v = unit === 'min' ? ratePerSec * 60 : ratePerSec
  if (v >= 100) return v.toFixed(0)
  if (v >= 10) return v.toFixed(1)
  // Tiny non-zero rates (nuclear fuel per second) would read 0.00: keep two significant digits.
  if (v >= 1e-6 && v < 0.005) return v.toPrecision(2)
  return v.toFixed(2)
}

export function fmtPower(kw: number): { value: string; unit: string } {
  if (kw < 1) return { value: (kw * 1000).toFixed(0), unit: 'W' }
  if (kw < 1000) return { value: kw.toFixed(1), unit: 'kW' }
  if (kw < 1_000_000) return { value: (kw / 1000).toFixed(1), unit: 'MW' }
  return { value: (kw / 1_000_000).toFixed(1), unit: 'GW' }
}

/**
 * A rate of `itemId` as a value and a unit. Electricity and heat (1 unit/s = 1 MW) are always
 * shown in power units, whatever the rate unit; everything else follows `unit`.
 */
export function fmtItemRate(itemId: string | undefined, ratePerSec: number, unit: RateUnit): { value: string; unit: string } {
  if (isEnergyItem(itemId)) return fmtPower(ratePerSec * 1000)
  return { value: fmtRate(ratePerSec, unit), unit: unit === 'min' ? '/m' : '/s' }
}

/** `fmtItemRate` as one string, e.g. "10.0MW" or "60.0/m". */
export function fmtItemRateText(itemId: string | undefined, ratePerSec: number, unit: RateUnit): string {
  const r = fmtItemRate(itemId, ratePerSec, unit)
  return r.value + r.unit
}

/** The unit a rate input for `itemId` is typed in: MW (rate unit 'sec') for electricity and heat. */
export function inputRateUnit(itemId: string | undefined, unit: RateUnit): RateUnit {
  return isEnergyItem(itemId) ? 'sec' : unit
}
