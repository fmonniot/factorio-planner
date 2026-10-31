/**
 * energy.js
 *
 * Energy helpers shared by the game-data exporter and its extraction and
 * power exports (power in kW, energy in kJ).
 * Kept free of side effects so unit tests can import it (build-game-data.js
 * runs its main code at the top level).
 */

// ---------------------------------------------------------------------------
// Energy parsing — energy strings (W/kW/MW/GW/TW) to kW
// ---------------------------------------------------------------------------

export function parseEnergyKw(s) {
  if (s == null) return 0
  if (typeof s === 'number') return s / 1000
  if (typeof s !== 'string' || s === '') return 0
  const m = s.match(/^([\d.]+)\s*([kKmMgGtT]?[wW])/)
  if (!m) return 0
  const num = parseFloat(m[1])
  const u   = m[2].toUpperCase()
  if (u === 'KW') return num
  if (u === 'MW') return num * 1000
  if (u === 'GW') return num * 1_000_000
  if (u === 'TW') return num * 1_000_000_000
  return num / 1000 // plain W
}

// ---------------------------------------------------------------------------
// Energy amounts — joule strings to kJ, and per-tick joule strings to kW
// ---------------------------------------------------------------------------

const JOULE_FACTORS_KJ = {
  '': 1e-3, k: 1, K: 1, M: 1e3, G: 1e6, T: 1e9, P: 1e12, E: 1e15, Z: 1e18, Y: 1e21,
}

/** Energy in kJ from a joule string ("4MJ", "0.2kJ") or a number of joules. 0 for anything else, W strings included. */
export function parseEnergyKj(s) {
  if (s == null) return 0
  if (typeof s === 'number') return s / 1000
  if (typeof s !== 'string' || s === '') return 0
  const m = s.match(/^([\d.]+(?:e[+-]?\d+)?)\s*([kKMGTPEZY]?)J$/)
  if (!m) return 0
  return parseFloat(m[1]) * JOULE_FACTORS_KJ[m[2]]
}

/**
 * Power in kW from a watt string, or from a joule string read as energy per tick
 * (Factorio's `max_power_output` is one or the other). 0 for anything else.
 */
export function parsePowerKw(s) {
  if (typeof s === 'string' && /J$/.test(s)) return parseEnergyKj(s) * 60
  return parseEnergyKw(s)
}

// ---------------------------------------------------------------------------
// Energy type inference
// ---------------------------------------------------------------------------

export function inferEnergyType(proto) {
  const t = proto.energy_source?.type
  if (t === 'electric') return 'electric'
  if (t === 'burner')   return 'burner'
  if (t === 'heat')     return 'heat'
  return 'void'
}
