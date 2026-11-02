/**
 * Burner fuel data, shared by the full export and `--patch-fuel` so the two
 * paths cannot disagree. Items get `fuelValueKj` / `fuelCategory` /
 * `burntResult`; burner crafting machines get `fuelCategories` / `effectivity`.
 * Fluid fuels and `burns_fluid` energy sources are out of scope.
 * Kept free of side effects so unit tests can import it.
 */

import { luaList } from './technologies.js'
import { parseEnergyKj } from './energy.js'

/** Prototype tables a bundle machine can come from. */
export const MACHINE_PROTO_TYPES = [
  'assembling-machine', 'furnace', 'rocket-silo', 'mining-drill', 'offshore-pump',
]

/** Fuel categories a burner energy source accepts. */
export function fuelCategories(source) {
  const list = luaList(source?.fuel_categories)
  if (list.length > 0) return list
  if (typeof source?.fuel_category === 'string') return [source.fuel_category]
  return ['chemical']
}

/**
 * Fuel fields of an item prototype; empty when it is not a fuel.
 * @param {any} proto item prototype
 * @returns {{ fuelValueKj?: number, fuelCategory?: string, burntResult?: string }}
 */
export function itemFuel(proto) {
  const kj = parseEnergyKj(proto?.fuel_value)
  if (!(kj > 0)) return {}
  const burnt = typeof proto.burnt_result === 'string' && proto.burnt_result ? proto.burnt_result : undefined
  return {
    fuelValueKj: kj,
    fuelCategory: proto.fuel_category ?? '',
    ...(burnt ? { burntResult: burnt } : {}),
  }
}

/**
 * Fuel fields of a machine prototype; empty unless its energy source is a burner.
 * @param {any} proto machine prototype
 * @returns {{ fuelCategories?: string[], effectivity?: number }}
 */
export function burnerFuel(proto) {
  const source = proto?.energy_source
  if (source?.type !== 'burner') return {}
  const eff = source.effectivity
  return {
    fuelCategories: fuelCategories(source),
    effectivity: typeof eff === 'number' && eff > 0 ? eff : 1,
  }
}

const FUEL_ITEM_KEYS = ['fuelValueKj', 'fuelCategory', 'burntResult']
const FUEL_MACHINE_KEYS = ['fuelCategories', 'effectivity']

const without = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)))

/**
 * Set the fuel fields on every bundle item that has a prototype and on every
 * bundle burner machine that has one; stale fuel fields are dropped first.
 * Everything else is returned as it is (same reference).
 * @param {Record<string, any>} items bundle items, keyed by id
 * @param {Record<string, any>} machines bundle machines, keyed by id
 * @param {Record<string, any>} raw the dump
 * @param {string[]} itemSubtypes prototype tables holding items (later tables win, as the export does)
 * @returns {{ items, machines, counts: { items: number, machines: number }, missingMachines: string[] }}
 */
export function attachFuel(items, machines, raw, itemSubtypes) {
  const protos = {}
  for (const subtype of itemSubtypes) {
    for (const proto of Object.values(raw[subtype] ?? {})) protos[proto.name] = proto
  }
  const outItems = {}
  let itemCount = 0
  for (const [id, item] of Object.entries(items)) {
    const proto = item.type === 'item' && Object.hasOwn(protos, id) ? protos[id] : undefined
    if (!proto) {
      outItems[id] = item
      continue
    }
    const fuel = itemFuel(proto)
    if (fuel.fuelValueKj !== undefined) itemCount++
    const same = FUEL_ITEM_KEYS.every(k => item[k] === fuel[k])
    outItems[id] = same ? item : { ...without(item, FUEL_ITEM_KEYS), ...fuel }
  }

  const outMachines = {}
  const missingMachines = []
  let machineCount = 0
  for (const [id, machine] of Object.entries(machines)) {
    if (machine.energyType !== 'burner') {
      outMachines[id] = machine
      continue
    }
    const proto = MACHINE_PROTO_TYPES.map(t => raw[t]).find(t => t && Object.hasOwn(t, id))?.[id]
    if (!proto) {
      missingMachines.push(id)
      outMachines[id] = machine
      continue
    }
    const fuel = burnerFuel(proto)
    if (fuel.fuelCategories) machineCount++
    outMachines[id] = { ...without(machine, FUEL_MACHINE_KEYS), ...fuel }
  }
  return { items: outItems, machines: outMachines, counts: { items: itemCount, machines: machineCount }, missingMachines }
}
