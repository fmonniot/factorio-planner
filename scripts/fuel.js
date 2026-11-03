/**
 * Burner fuel data, shared by the full export and `--patch-fuel` so the two
 * paths cannot disagree. Items get `fuelValueKj` / `fuelCategory` /
 * `burntResult`; burner crafting machines get `fuelCategories` / `effectivity`.
 * Fluids get `fuelValueKj`; machines whose energy source burns fluid
 * (`burns_fluid`) become `'fluid-burner'` with `effectivity` and, when the
 * source's fluid box is filtered, `fuelFluid`.
 * Kept free of side effects so unit tests can import it.
 */

import { luaList } from './technologies.js'
import { parseEnergyKj, inferEnergyType } from './energy.js'

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
    // The engine's default fuel category is 'chemical', as for burner sources.
    fuelCategory: typeof proto.fuel_category === 'string' && proto.fuel_category ? proto.fuel_category : 'chemical',
    ...(burnt ? { burntResult: burnt } : {}),
  }
}

/**
 * Fuel fields of a fluid prototype (kJ per unit); empty when it is not a fuel.
 * @param {any} proto fluid prototype
 * @returns {{ fuelValueKj?: number }}
 */
export function fluidFuel(proto) {
  const kj = parseEnergyKj(proto?.fuel_value)
  return kj > 0 ? { fuelValueKj: kj } : {}
}

/**
 * Fuel fields of a machine prototype; empty unless its energy source is a burner or burns fluid.
 * @param {any} proto machine prototype
 * @returns {{ fuelCategories?: string[], effectivity?: number, fuelFluid?: string }}
 */
export function burnerFuel(proto) {
  const source = proto?.energy_source
  const eff = source?.effectivity
  const effectivity = typeof eff === 'number' && eff > 0 ? eff : 1
  if (source?.type === 'burner') return { fuelCategories: fuelCategories(source), effectivity }
  if (source?.type === 'fluid' && source.burns_fluid) {
    const filter = source.fluid_box?.filter
    return { effectivity, ...(typeof filter === 'string' && filter ? { fuelFluid: filter } : {}) }
  }
  return {}
}

const FUEL_ITEM_KEYS = ['fuelValueKj', 'fuelCategory', 'burntResult']
const FUEL_FLUID_KEYS = ['fuelValueKj']
const FUEL_MACHINE_KEYS = ['fuelCategories', 'effectivity', 'fuelFluid']

const without = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)))

/**
 * Set the fuel fields on every bundle item and fluid that has a prototype and on every
 * bundle burner machine that has one; stale fuel fields are dropped first. A crafting
 * machine exported as 'void' whose source burns fluid becomes 'fluid-burner'.
 * Everything else is returned as it is (same reference).
 * @param {Record<string, any>} items bundle items, keyed by id
 * @param {Record<string, any>} machines bundle machines, keyed by id
 * @param {Record<string, any>} raw the dump
 * @param {string[]} itemSubtypes prototype tables holding items (later tables win, as the export does)
 * @returns {{ items, machines, counts: { items: number, machines: number, fluids: number, fluidMachines: number }, missingMachines: string[] }}
 */
export function attachFuel(items, machines, raw, itemSubtypes) {
  const protos = {}
  for (const subtype of itemSubtypes) {
    for (const proto of Object.values(raw[subtype] ?? {})) protos[proto.name] = proto
  }
  const fluidProtos = raw.fluid ?? {}
  const outItems = {}
  let itemCount = 0
  let fluidCount = 0
  for (const [id, item] of Object.entries(items)) {
    if (item.type === 'fluid' && Object.hasOwn(fluidProtos, id)) {
      const fuel = fluidFuel(fluidProtos[id])
      if (fuel.fuelValueKj !== undefined) fluidCount++
      const same = FUEL_FLUID_KEYS.every(k => item[k] === fuel[k])
      outItems[id] = same ? item : { ...without(item, FUEL_FLUID_KEYS), ...fuel }
      continue
    }
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
  let fluidMachineCount = 0
  for (const [id, machine] of Object.entries(machines)) {
    // A 'void' machine may burn fluid whatever its kW (the extraction export zeroes it). Power-generation
    // machines (also 'void', 0 kW) stay out because their prototypes are not in MACHINE_PROTO_TYPES.
    const candidate = machine.energyType === 'burner' || machine.energyType === 'fluid-burner' || machine.energyType === 'void'
    if (!candidate) {
      outMachines[id] = machine
      continue
    }
    const proto = MACHINE_PROTO_TYPES.map(t => raw[t]).find(t => t && Object.hasOwn(t, id))?.[id]
    if (!proto) {
      if (machine.energyType === 'burner' || machine.energyType === 'fluid-burner') missingMachines.push(id)
      outMachines[id] = machine
      continue
    }
    const fuel = burnerFuel(proto)
    if (fuel.fuelCategories) {
      machineCount++
      outMachines[id] = { ...without(machine, FUEL_MACHINE_KEYS), ...fuel }
    } else if (fuel.effectivity !== undefined) {
      fluidMachineCount++
      outMachines[id] = { ...without(machine, FUEL_MACHINE_KEYS), ...fuel, energyType: 'fluid-burner' }
    } else if (machine.energyType === 'burner') {
      outMachines[id] = without(machine, FUEL_MACHINE_KEYS)
    } else if (machine.energyType === 'fluid-burner') {
      // The prototype no longer burns fluid: back to whatever its source is, without stale fuel fields.
      outMachines[id] = { ...without(machine, FUEL_MACHINE_KEYS), energyType: inferEnergyType(proto) }
    } else {
      outMachines[id] = machine
    }
  }
  return {
    items: outItems,
    machines: outMachines,
    counts: { items: itemCount, machines: machineCount, fluids: fluidCount, fluidMachines: fluidMachineCount },
    missingMachines,
  }
}

/**
 * True when at least one burner machine with fuel categories accepts at least one fuel item, or a fluid-burner machine and a fluid fuel exist.
 * @param {Record<string, any>} items bundle items after `attachFuel`
 * @param {Record<string, any>} machines bundle machines after `attachFuel`
 */
export function fuelOverlaps(items, machines) {
  const categories = new Set(Object.values(items).filter(i => i.fuelValueKj > 0 && i.type === 'item').map(i => i.fuelCategory))
  const fluidFuels = Object.values(items).some(i => i.type === 'fluid' && i.fuelValueKj > 0)
  return Object.values(machines).some(m =>
    (m.fuelCategories ?? []).some(c => categories.has(c)) || (m.energyType === 'fluid-burner' && fluidFuels))
}
