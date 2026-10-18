/**
 * energy.js
 *
 * Energy helpers shared by the game-data exporter and its extraction export.
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
// Energy type inference
// ---------------------------------------------------------------------------

export function inferEnergyType(proto) {
  const t = proto.energy_source?.type
  if (t === 'electric') return 'electric'
  if (t === 'burner')   return 'burner'
  if (t === 'heat')     return 'heat'
  return 'void'
}
