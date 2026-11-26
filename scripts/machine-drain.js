/**
 * Machine idle drain for `--patch-machine-drain`: writes `drainKw` on the bundle's crafting machines, drills and
 * pumps from the dump, using the same helper as the full export so the two paths cannot disagree.
 * Kept free of side effects so unit tests can import it.
 */

import { parseEnergyKw, energyDrainKw, inferEnergyType } from './energy.js'
import { MACHINE_PROTO_TYPES } from './fuel.js'

/** Equal within a small relative tolerance, so a re-parsed float does not read as a different dump. */
const sameKw = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b))

/**
 * Write `drainKw` into the bundle's machines. Power-generation machines (boilers, generators) are not candidates.
 * A machine missing from the dump, or whose `energy_usage` or energy type there differs from the bundle's (a dump of another mod
 * set), is listed and its entry kept. Returns the same object references when nothing changed. Safe to re-run.
 * @param {Record<string, any>} machines bundle machines
 * @param {Record<string, any>} raw data-raw dump
 */
export function attachMachineDrain(machines, raw) {
  const missing = []
  const mismatched = []
  const counts = { electric: 0, changed: 0 }
  const out = {}
  let total = 0
  let changed = false
  for (const [id, machine] of Object.entries(machines ?? {})) {
    if (!MACHINE_PROTO_TYPES.includes(machine.type)) {
      out[id] = machine
      continue
    }
    total++
    const table = raw[machine.type]
    const proto = table && Object.hasOwn(table, id) ? table[id] : undefined
    if (!proto) {
      missing.push(id)
      out[id] = machine
      continue
    }
    if (inferEnergyType(proto) !== machine.energyType || (machine.energyType !== 'void' && !sameKw(parseEnergyKw(proto.energy_usage), machine.energyUsageKw))) {
      mismatched.push(id)
      out[id] = machine
      continue
    }
    if (machine.energyType === 'electric') counts.electric++
    const drainKw = energyDrainKw(proto)
    if (machine.drainKw === drainKw) {
      out[id] = machine
      continue
    }
    out[id] = { ...machine, drainKw }
    counts.changed++
    changed = true
  }
  return { machines: changed ? out : machines, counts, missing, mismatched, total }
}
