/**
 * Beacon power draw (`energy_usage` and the explicit `energy_source.drain`), shared by the full export and
 * `--patch-beacon-energy` so the two paths cannot disagree. Only electric beacons carry the fields; absent = draws
 * nothing (void beacons, or a bundle exported before the fields existed). Drain mirrors machines: explicit only.
 * Kept free of side effects so unit tests can import it.
 */

import { parseEnergyKw, inferEnergyType } from './energy.js'

const FIELDS = ['energyUsageKw', 'drainKw']

/**
 * The `energyUsageKw` and `drainKw` fields of a beacon, or `{}` when it is not electric.
 * @param {any} proto beacon prototype
 * @returns {{ energyUsageKw?: number, drainKw?: number }}
 */
export function beaconEnergyField(proto) {
  if (inferEnergyType(proto) !== 'electric') return {}
  return {
    energyUsageKw: parseEnergyKw(proto.energy_usage),
    drainKw: parseEnergyKw(proto.energy_source?.drain),
  }
}

function withField(beacon, proto) {
  const field = beaconEnergyField(proto)
  const same = FIELDS.every(k => beacon[k] === field[k])
  if (same) return beacon
  const rest = { ...beacon }
  for (const k of FIELDS) delete rest[k]
  return { ...rest, ...field }
}

/**
 * Write the beacon power fields into the bundle's beacons. A beacon missing from the dump is listed in `missing` and
 * its entry kept. A stale field on a beacon that is now void is removed. Returns the same object references when
 * nothing changed. Safe to re-run.
 * @param {Record<string, any>} beacons bundle beacons
 * @param {Record<string, any>} raw data-raw dump
 */
export function attachBeaconEnergy(beacons, raw) {
  const missing = []
  const counts = { electric: 0, void: 0 }
  const out = {}
  let total = 0
  let changed = false
  for (const [id, beacon] of Object.entries(beacons ?? {})) {
    total++
    const proto = raw.beacon && Object.hasOwn(raw.beacon, id) ? raw.beacon[id] : undefined
    if (!proto) {
      missing.push(id)
      out[id] = beacon
      continue
    }
    out[id] = withField(beacon, proto)
    if (out[id] !== beacon) changed = true
    if (Object.hasOwn(out[id], 'energyUsageKw')) counts.electric++
    else counts.void++
  }
  return { beacons: changed ? out : beacons, counts, missing, total }
}

/**
 * The bundle with the result of {@link attachBeaconEnergy} written in. Only `beacons` is replaced; a bundle without
 * a `beacons` key stays without one.
 * @param {Record<string, any>} existing bundle
 * @param {{ beacons: Record<string, any> }} attached
 */
export function patchedBundle(existing, attached) {
  return {
    ...existing,
    ...(existing.beacons !== undefined ? { beacons: attached.beacons } : {}),
  }
}
