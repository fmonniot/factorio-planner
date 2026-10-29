/**
 * power.js
 *
 * Pure helpers that turn the `boiler`, `generator`, `burner-generator` and
 * `solar-panel` prototypes of a `factorio --dump-data` dump into power
 * generation recipes and the machines that run them. Electricity is an
 * ordinary pseudo-item (1 unit = 1 MJ, so 1 unit/s = 1 MW), so the solver
 * needs no special case. Recipes have one machine, `craftingTime` 1 and a
 * generated `power:<machine>` category: amounts are per second per building.
 * Kept free of side effects so unit tests can import it.
 */

import { luaList } from './technologies.js'
import { parseEnergyKj, parsePowerKw } from './energy.js'

/** Must equal ELECTRICITY_ITEM_ID in src/data/electricity.ts. */
export const ELECTRICITY_ITEM_ID = 'power:electricity'
export const POWER_PREFIX = 'power:'
export const POWER_GROUP_ID = 'power:power'
export const POWER_SUBGROUPS = {
  electricity:      'power:electricity',
  boilers:          'power:boilers',
  generators:       'power:generators',
  burnerGenerators: 'power:burner-generators',
  solarPanels:      'power:solar-panels',
}
export const POWER_MACHINE_TYPES = ['boiler', 'generator', 'burner-generator', 'solar-panel']

/** Fraction of its peak output a solar panel delivers on average (Nauvis day / night cycle). */
export const SOLAR_AVERAGE_FACTOR = 0.7
/** kJ per unit and degree for a fluid without `heat_capacity` (the engine default). */
export const DEFAULT_HEAT_CAPACITY_KJ = 1

const SUBGROUP_ORDER = {
  [POWER_SUBGROUPS.electricity]:      'a',
  [POWER_SUBGROUPS.boilers]:          'b',
  [POWER_SUBGROUPS.generators]:       'c',
  [POWER_SUBGROUPS.burnerGenerators]: 'd',
  [POWER_SUBGROUPS.solarPanels]:      'e',
}

/** True for a category this module generates (`power:<machine>`). */
export function isPowerCategory(category) {
  return category.startsWith(POWER_PREFIX)
}

/** A hidden generator that cannot be mined is placed by a script as part of a compound entity (Nullius' turbines). */
export function isScriptPlacedGenerator(proto) {
  return Boolean(proto.hidden) && !proto.minable?.result && !proto.minable?.results
}

/** Label of a recipe without an input (solar), so it never shares a name with the crafting recipe of the same item. */
export const NO_INPUT_LABEL = 'electricity'

/** "<machine> (<input>)"; a recipe without an input (solar) is "<machine> (electricity)". */
export function powerRecipeName(machineName, inputName) {
  return `${machineName} (${inputName || NO_INPUT_LABEL})`
}

/** Split `power:<machine>[:<input>]`; `inputId` is undefined for solar panels. */
export function parsePowerRecipeId(id) {
  const rest = id.slice(POWER_PREFIX.length)
  const i = rest.indexOf(':')
  if (i < 0) return { machineId: rest, inputId: undefined }
  return { machineId: rest.slice(0, i), inputId: rest.slice(i + 1) }
}

const heatCapacityKj = (fluid) => parseEnergyKj(fluid?.heat_capacity) || DEFAULT_HEAT_CAPACITY_KJ

/** Fuel categories a burner energy source accepts. */
function fuelCategories(source) {
  const list = luaList(source?.fuel_categories)
  if (list.length > 0) return list
  if (typeof source?.fuel_category === 'string') return [source.fuel_category]
  return ['chemical']
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * @param raw prototype dump
 * @param opts { entityName(proto), itemName(proto), fluidName(proto), resolveIcon(proto, id): Promise<string>, itemSubtypes: string[] }
 * @returns {Promise<{ machines, recipes, items, itemGroups, itemSubgroups }>}
 */
export async function exportPower(raw, opts) {
  const { entityName, itemName, fluidName, resolveIcon, itemSubtypes } = opts
  const machines = {}
  const recipes = {}
  const usedSubgroups = new Set()

  // --- Fuels --------------------------------------------------------------
  // Last table wins, as exportItems does.
  const itemProtos = {}
  for (const subtype of itemSubtypes) {
    for (const proto of Object.values(raw[subtype] ?? {})) itemProtos[proto.name] = proto
  }
  // A fuel with a burnt result is refused by a burner that has no burnt inventory.
  const fuelItemsOf = (categories, burntSlots) => Object.values(itemProtos)
    .filter(p => !p.hidden && categories.includes(p.fuel_category ?? '') && parseEnergyKj(p.fuel_value) > 0
      && (burntSlots > 0 || !p.burnt_result))
    .map(p => ({
      id: p.name, type: 'item', kj: parseEnergyKj(p.fuel_value),
      burnt: typeof p.burnt_result === 'string' && p.burnt_result ? p.burnt_result : undefined,
      name: itemName(p),
    }))
    .sort(byId)
  const fluidFuel = (proto) => ({
    id: proto.name, type: 'fluid', kj: parseEnergyKj(proto.fuel_value), burnt: undefined, name: fluidName(proto),
  })
  const allFluidFuels = () => Object.values(raw.fluid ?? {})
    .filter(p => !p.hidden && parseEnergyKj(p.fuel_value) > 0)
    .map(fluidFuel)
    .sort(byId)

  const skip = (kind, proto, why) => console.warn(`[power] skipping ${kind} ${proto.name}: ${why}`)

  // Records one machine's recipes and the machine itself (only when it has a recipe).
  const addMachine = async (proto, type, subgroup, entries) => {
    if (entries.length === 0) return
    const category = POWER_PREFIX + proto.name
    const machineName = entityName(proto)
    for (const e of entries) {
      const id = e.input ? `${POWER_PREFIX}${proto.name}:${e.input.id}` : `${POWER_PREFIX}${proto.name}`
      recipes[id] = {
        id,
        name:              powerRecipeName(machineName, e.input?.name),
        category,
        craftingTime:      1,
        ingredients:       e.ingredients,
        products:          e.products,
        madeIn:            [proto.name],
        allowProductivity: false,
        hidden:            false,
        subgroup,
        order:             '',
        power:             true,
        mainProduct:       e.mainProduct,
      }
    }
    usedSubgroups.add(subgroup)
    machines[proto.name] = {
      id:                 proto.name,
      name:               machineName,
      type,
      craftingSpeed:      1,
      energyUsageKw:      0,
      energyType:         'void',
      drainKw:            0,
      moduleSlots:        0,
      allowedEffects:     [],
      craftingCategories: [category],
      iconPath:           await resolveIcon(proto, proto.name),
      hidden:             false,
    }
  }

  const burnt = (fuel, amount) => (fuel.burnt ? [{ itemId: fuel.burnt, type: 'item', amount }] : [])

  // --- Boilers ------------------------------------------------------------
  for (const proto of Object.values(raw.boiler ?? {})) {
    if (proto.hidden) continue
    const source = proto.energy_source ?? {}
    let fuels
    if (source.type === 'burner') {
      fuels = fuelItemsOf(fuelCategories(source), source.burnt_inventory_size ?? 0)
    } else if (source.type === 'fluid' && source.burns_fluid) {
      const filter = source.fluid_box?.filter
      fuels = filter ? (raw.fluid?.[filter] && !raw.fluid[filter].hidden ? [fluidFuel(raw.fluid[filter])] : []) : allFluidFuels()
      fuels = fuels.filter(f => f.kj > 0)
    } else {
      skip('boiler', proto, `${source.type ?? 'unknown'} energy source is not a burning one`)
      continue
    }
    if ((proto.mode ?? 'output-to-separate-pipe') !== 'output-to-separate-pipe') {
      skip('boiler', proto, `mode ${proto.mode}`)
      continue
    }
    const inFluid  = raw.fluid?.[proto.fluid_box?.filter]
    const outFluid = raw.fluid?.[proto.output_fluid_box?.filter]
    const target   = proto.target_temperature
    if (!inFluid || !outFluid || typeof target !== 'number') {
      skip('boiler', proto, 'missing fluid filter or target_temperature')
      continue
    }
    const powerKw = parsePowerKw(proto.energy_consumption)
    const perUnit = heatCapacityKj(outFluid) * (target - (inFluid.default_temperature ?? 15))
    if (!(powerKw > 0) || !(perUnit > 0)) {
      skip('boiler', proto, 'non-positive power or heat per unit')
      continue
    }
    const steamPerSec = powerKw / perUnit
    const eff = source.effectivity ?? 1
    const entries = fuels.map(fuel => {
      const fuelPerSec = powerKw / (fuel.kj * eff)
      return {
        input: fuel,
        ingredients: [
          { itemId: inFluid.name, type: 'fluid', amount: steamPerSec },
          { itemId: fuel.id, type: fuel.type, amount: fuelPerSec },
        ],
        products: [{ itemId: outFluid.name, type: 'fluid', amount: steamPerSec }, ...burnt(fuel, fuelPerSec)],
        mainProduct: outFluid.name,
      }
    })
    await addMachine(proto, 'boiler', POWER_SUBGROUPS.boilers, entries)
  }

  // --- Fluid generators (steam engines, turbines) -------------------------
  for (const proto of Object.values(raw.generator ?? {})) {
    if (proto.hidden && !isScriptPlacedGenerator(proto)) continue
    const filter = proto.fluid_box?.filter
    const use = (proto.fluid_usage_per_tick ?? 0) * 60
    const eff = proto.effectivity ?? 1
    const burns = Boolean(proto.burns_fluid)
    if (!(use > 0)) {
      skip('generator', proto, 'no positive fluid_usage_per_tick')
      continue
    }
    let inputs
    if (burns) {
      // The generator's own filter fluid counts even when hidden (nullius-energy).
      inputs = filter ? (raw.fluid?.[filter] ? [fluidFuel(raw.fluid[filter])] : []) : allFluidFuels()
      inputs = inputs.filter(f => f.kj > 0)
    } else {
      inputs = filter && raw.fluid?.[filter] ? [{ id: filter, type: 'fluid', name: fluidName(raw.fluid[filter]) }] : []
      if (inputs.length === 0) {
        skip('generator', proto, 'no fluid filter')
        continue
      }
    }
    const cap = proto.max_power_output ? parsePowerKw(proto.max_power_output) : Infinity
    const temperature = proto.maximum_temperature ?? (filter ? raw.fluid?.[filter]?.max_temperature : undefined)
    const entries = []
    for (const input of inputs) {
      let perUnit
      if (burns) {
        perUnit = input.kj
      } else {
        if (typeof temperature !== 'number') {
          skip('generator', proto, 'no maximum_temperature')
          continue
        }
        const fluid = raw.fluid[input.id]
        perUnit = heatCapacityKj(fluid) * (temperature - (fluid.default_temperature ?? 15))
      }
      const full = use * perUnit * eff
      if (!(full > 0)) {
        skip('generator', proto, `non-positive output on ${input.id}`)
        continue
      }
      const outKw = Math.min(full, cap)
      const consumption = proto.scale_fluid_usage && full > cap ? cap / (perUnit * eff) : use
      entries.push({
        input,
        ingredients: [{
          itemId: input.id, type: 'fluid', amount: consumption,
          ...(burns ? {} : { minimumTemperature: temperature }),
        }],
        products: [{ itemId: ELECTRICITY_ITEM_ID, type: 'fluid', amount: outKw / 1000 }],
        mainProduct: ELECTRICITY_ITEM_ID,
      })
    }
    await addMachine(proto, 'generator', POWER_SUBGROUPS.generators, entries)
  }

  // --- Burner generators --------------------------------------------------
  for (const proto of Object.values(raw['burner-generator'] ?? {})) {
    if (proto.hidden) continue
    const outKw = parsePowerKw(proto.max_power_output)
    if (!(outKw > 0)) {
      skip('burner-generator', proto, 'no max_power_output')
      continue
    }
    const eff = proto.burner?.effectivity ?? 1
    const entries = fuelItemsOf(fuelCategories(proto.burner), proto.burner?.burnt_inventory_size ?? 0).map(fuel => {
      const fuelPerSec = outKw / (fuel.kj * eff)
      return {
        input: fuel,
        ingredients: [{ itemId: fuel.id, type: 'item', amount: fuelPerSec }],
        products: [{ itemId: ELECTRICITY_ITEM_ID, type: 'fluid', amount: outKw / 1000 }, ...burnt(fuel, fuelPerSec)],
        mainProduct: ELECTRICITY_ITEM_ID,
      }
    })
    await addMachine(proto, 'burner-generator', POWER_SUBGROUPS.burnerGenerators, entries)
  }

  // --- Solar panels -------------------------------------------------------
  for (const proto of Object.values(raw['solar-panel'] ?? {})) {
    if (proto.hidden) continue
    const peakKw = parsePowerKw(proto.production)
    if (!(peakKw > 0)) {
      skip('solar-panel', proto, 'no production')
      continue
    }
    await addMachine(proto, 'solar-panel', POWER_SUBGROUPS.solarPanels, [{
      input: undefined,
      ingredients: [],
      products: [{ itemId: ELECTRICITY_ITEM_ID, type: 'fluid', amount: (peakKw * SOLAR_AVERAGE_FACTOR) / 1000 }],
      mainProduct: ELECTRICITY_ITEM_ID,
    }])
  }

  // --- Electricity item, group and subgroups ------------------------------
  const items = {}
  const itemGroups = {}
  const itemSubgroups = {}
  if (Object.keys(recipes).length > 0) {
    const signal = raw['virtual-signal']?.['signal-lightning']
    const iconPath = signal ? await resolveIcon(signal, 'power-electricity') : ''
    items[ELECTRICITY_ITEM_ID] = {
      id:       ELECTRICITY_ITEM_ID,
      name:     'Electricity',
      type:     'fluid',
      iconPath,
      hidden:   false,
      subgroup: POWER_SUBGROUPS.electricity,
      order:    'a',
    }
    itemGroups[POWER_GROUP_ID] = { id: POWER_GROUP_ID, name: 'Power', order: 'zz', iconPath }
    for (const id of [POWER_SUBGROUPS.electricity, ...usedSubgroups]) {
      itemSubgroups[id] = { id, group: POWER_GROUP_ID, order: SUBGROUP_ORDER[id] }
    }
  }

  return { machines, recipes, items, itemGroups, itemSubgroups }
}
