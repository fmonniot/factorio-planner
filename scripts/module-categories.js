/**
 * Module categories machines and beacons accept (Factorio 2.0 `allowed_module_categories`), shared by the full
 * export and `--patch-module-categories` so the two paths cannot disagree. Absent on an entity = every category,
 * `[]` = none. Only entities with module slots carry the field.
 * Kept free of side effects so unit tests can import it.
 */

import { luaList } from './technologies.js'
import { MACHINE_PROTO_TYPES } from './fuel.js'

/**
 * Sorted, deduped module categories a prototype accepts.
 * @param {any} proto machine or beacon prototype
 * @returns {string[] | undefined} undefined when the prototype has no list (every category)
 */
export function allowedModuleCategories(proto) {
  const raw = proto?.allowed_module_categories
  if (raw === undefined || raw === null) return undefined
  return [...new Set(luaList(raw).filter(c => typeof c === 'string'))].sort()
}

/**
 * The `allowedModuleCategories` field of an entity, or `{}` when it has no slots or no list.
 * @param {any} proto machine or beacon prototype
 * @param {number} moduleSlots
 * @returns {{ allowedModuleCategories?: string[] }}
 */
export function moduleCategoriesField(proto, moduleSlots) {
  if (!(moduleSlots > 0)) return {}
  const list = allowedModuleCategories(proto)
  return list === undefined ? {} : { allowedModuleCategories: list }
}

function withField(entity, proto) {
  const { allowedModuleCategories: _old, ...rest } = entity
  const field = moduleCategoriesField(proto, entity.moduleSlots)
  const same = JSON.stringify(entity.allowedModuleCategories) === JSON.stringify(field.allowedModuleCategories)
  return same ? entity : { ...rest, ...field }
}

/**
 * Write `allowedModuleCategories` into the bundle's machines and beacons that have module slots. A prototype missing
 * from the dump is listed in `missing` and its entry kept. Zero-slot machines (and offshore pumps, power machines
 * without slots) are untouched. Returns the same object references when nothing changed. Safe to re-run.
 * @param {Record<string, any>} machines bundle machines
 * @param {Record<string, any> | undefined} beacons bundle beacons
 * @param {Record<string, any>} raw data-raw dump
 */
export function attachModuleCategories(machines, beacons, raw) {
  const missing = []
  let slotted = 0
  const counts = { machines: 0, beacons: 0 }

  const outMachines = {}
  for (const [id, machine] of Object.entries(machines)) {
    if (!(machine.moduleSlots > 0)) {
      outMachines[id] = machine
      continue
    }
    slotted++
    const proto = MACHINE_PROTO_TYPES.map(t => raw[t]).find(t => t && Object.hasOwn(t, id))?.[id]
    if (!proto) {
      missing.push(id)
      outMachines[id] = machine
      continue
    }
    outMachines[id] = withField(machine, proto)
    if (outMachines[id].allowedModuleCategories !== undefined) counts.machines++
  }

  const outBeacons = {}
  for (const [id, beacon] of Object.entries(beacons ?? {})) {
    if (!(beacon.moduleSlots > 0)) {
      outBeacons[id] = beacon
      continue
    }
    slotted++
    const proto = raw.beacon && Object.hasOwn(raw.beacon, id) ? raw.beacon[id] : undefined
    if (!proto) {
      missing.push(id)
      outBeacons[id] = beacon
      continue
    }
    outBeacons[id] = withField(beacon, proto)
    if (outBeacons[id].allowedModuleCategories !== undefined) counts.beacons++
  }

  return { machines: outMachines, beacons: outBeacons, counts, missing, slotted }
}
