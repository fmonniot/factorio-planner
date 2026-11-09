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

const CHIP_UNITS: ReadonlyArray<readonly [number, string]> = [[1e3, 'k'], [1e6, 'M'], [1e9, 'G']]

/**
 * The quantity on a table chip (a rate in the displayed unit), written to fit the chip's corner: five characters at most.
 * From 10 000 up whole thousands (`12k`), from 1 000 one decimal (`1.1k`, `.0` dropped), from 100 no decimals, from 1 one
 * decimal, from 0.01 two decimals without the leading zero (`.05`), below that `<.01`. The thresholds apply to the rounded
 * value: a value that rounds up across one uses the next format (0.996 reads `1.0`, 999.6 reads `1k`, 999 500 reads `1M`).
 * From a million the same pattern continues with `M` and `G`; from 999.5 G (and for Infinity) it reads `>999G`. NaN and
 * negative values, which a rate never is, read `?` instead of claiming to be tiny. The chip's tooltip keeps the exact rate
 * (`fmtItemRateText`); `fmtRate` is unchanged and still used everywhere else.
 */
export function chipFmt(v: number): string {
  if (Number.isNaN(v) || v < 0) return '?'
  if (v === 0) return '0'
  if (v >= 999.5) {
    for (const [unit, suffix] of CHIP_UNITS) {
      const x = v / unit
      if (x < 10) return x.toFixed(1).replace(/\.0$/, '') + suffix
      const r = Math.round(x)
      if (r < 1000) return r + suffix
    }
    return '>999G'
  }
  if (v >= 100) return v.toFixed(0)
  if (v >= 10) {
    // 99.96 rounds to "100.0": drop the decimal so the quantity stays at four characters.
    const s = v.toFixed(1)
    return s === '100.0' ? '100' : s
  }
  if (v >= 1) return v.toFixed(1)
  if (v >= 0.01) {
    // 0.996 rounds to "1.00": it reads like 1 does.
    const s = v.toFixed(2)
    return s === '1.00' ? '1.0' : s.replace(/^0/, '')
  }
  return '<.01'
}

export function fmtPower(kw: number): { value: string; unit: string } {
  // Thresholds are on the rounded value, so 999.96 kW reads "1.0MW" and not "1000.0kW".
  if (kw * 1000 < 999.5) return { value: (kw * 1000).toFixed(0), unit: 'W' }
  if (kw < 999.95) return { value: kw.toFixed(1), unit: 'kW' }
  if (kw < 999_950) return { value: (kw / 1000).toFixed(1), unit: 'MW' }
  return { value: (kw / 1_000_000).toFixed(1), unit: 'GW' }
}

/** Electricity or heat at `unitsPerSec` (1 unit/s = 1 MW) as one string, e.g. "10.0MW". */
export function fmtEnergyText(unitsPerSec: number): string {
  const p = fmtPower(unitsPerSec * 1000)
  return p.value + p.unit
}

/**
 * A rate of `itemId` as a value and a unit. Electricity and heat (1 unit/s = 1 MW) are always
 * shown in power units, whatever the rate unit; everything else follows `unit`.
 */
export function fmtItemRate(itemId: string | undefined, ratePerSec: number, unit: RateUnit): { value: string; unit: string } {
  if (isEnergyItem(itemId)) return fmtPower(ratePerSec * 1000)
  return { value: fmtRate(ratePerSec, unit), unit: unit === 'min' ? '/m' : '/s' }
}

const POWER_UNITS = ['W', 'kW', 'MW', 'GW']

/**
 * Electricity or heat (1 unit/s = 1 MW) for a table chip's corner, in power units and five characters at most: `fmtPower`'s value
 * with the decimal dropped from 10 up (`10MW`, `100kW`, `999W`), so `10.0MW` and `999.9kW` no longer spill out of the 32px chip.
 * A value that rounds to 1000 takes the next unit (`1.0MW`); from 999.5 GW it reads `>999G`. The tooltip keeps the exact value.
 */
function chipEnergy(unitsPerSec: number): string {
  if (Number.isNaN(unitsPerSec) || unitsPerSec < 0) return '?'
  const p = fmtPower(unitsPerSec * 1000)
  const n = Number(p.value)
  if (p.unit === 'W' || n < 10) return p.value + p.unit
  const r = Math.round(n)
  if (r < 1000) return r + p.unit
  const next = POWER_UNITS[POWER_UNITS.indexOf(p.unit) + 1]
  return next ? '1.0' + next : '>999G'
}

/** `fmtItemRate` for a table chip's corner: items through `chipFmt`, electricity and heat in power units (`chipEnergy`). */
export function fmtChipQuantity(itemId: string | undefined, ratePerSec: number, unit: RateUnit): string {
  if (isEnergyItem(itemId)) return chipEnergy(ratePerSec)
  return chipFmt(unit === 'min' ? ratePerSec * 60 : ratePerSec)
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
