/**
 * Machine idle drain for `--patch-machine-drain`: writes `drainKw` on the bundle's crafting machines, drills and
 * pumps from the dump, using the same helper as the full export so the two paths cannot disagree.
 * Kept free of side effects so unit tests can import it.
 */

import { parseEnergyKw, energyDrainKw } from './energy.js'
import { MACHINE_PROTO_TYPES } from './fuel.js'

/**
 * Write `drainKw` into the bundle's machines. Power-generation machines (boilers, generators) are not candidates.
 * A machine missing from the dump, or whose `energy_usage` there differs from the bundle's (a dump of another mod
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
    if (machine.energyType !== 'void' && parseEnergyKw(proto.energy_usage) !== machine.energyUsageKw) {
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
