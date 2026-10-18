/**
 * extraction.js
 *
 * Pure helpers that turn the `resource`, `mining-drill` and `offshore-pump`
 * prototypes of a `factorio --dump-data` dump into extraction recipes and the
 * machines that run them. The recipes use generated categories (`mining:`,
 * `mining-with-fluid:`, `offshore:`) so the solver treats them like any other
 * recipe. Kept free of side effects so unit tests can import it.
 */

import { luaList } from './technologies.js'
import { parseEnergyKw, inferEnergyType } from './energy.js'

export const ALL_EFFECTS = ['consumption', 'pollution', 'productivity', 'quality', 'speed']

/** Factorio's default resource category. */
export const DEFAULT_RESOURCE_CATEGORY = 'basic-solid'

const MINING_PREFIX = 'mining:'
const MINING_FLUID_PREFIX = 'mining-with-fluid:'
const OFFSHORE_PREFIX = 'offshore:'

/** True for a category this module generates (mining:, mining-with-fluid:, offshore:). */
export function isExtractionCategory(category) {
  return category.startsWith(MINING_PREFIX)
    || category.startsWith(MINING_FLUID_PREFIX)
    || category.startsWith(OFFSHORE_PREFIX)
}

/** Fluids an offshore pump produces: fluid_box.filter, else proto.fluid, else distinct tile fluids. */
export function offshorePumpFluids(proto, raw) {
  const filter = proto.fluid_box?.filter
  if (typeof filter === 'string' && filter) return [filter]
  if (typeof proto.fluid === 'string' && proto.fluid) return [proto.fluid]
  const fluids = new Set()
  for (const tile of Object.values(raw.tile ?? {})) {
    if (typeof tile.fluid === 'string' && tile.fluid) fluids.add(tile.fluid)
  }
  return [...fluids].sort()
}

/** Normalise one `minable.results` entry like a recipe product (see normaliseProduct in build-game-data.js). */
function resourceProduct(prod) {
  if (Array.isArray(prod)) {
    return { itemId: prod[0], type: 'item', amount: prod[1], probability: 1 }
  }
  return {
    itemId:                prod.name,
    type:                  prod.type ?? 'item',
    amount:                prod.amount ?? prod.amount_max ?? 0,
    probability:           prod.probability,
    amountMin:             prod.amount_min,
    amountMax:             prod.amount_max,
    ignoredByProductivity: prod.ignored_by_productivity,
  }
}

function resourceProducts(minable) {
  if (minable.results) return luaList(minable.results).map(resourceProduct)
  if (minable.result) {
    return [{ itemId: minable.result, type: 'item', amount: minable.count ?? 1, probability: 1 }]
  }
  return []
}

function machineEnergy(proto) {
  const energyType = inferEnergyType(proto)
  return {
    energyUsageKw: proto.energy_source?.type === 'void' ? 0 : parseEnergyKw(proto.energy_usage),
    energyType,
    drainKw:       parseEnergyKw(proto.energy_source?.drain),
  }
}

/**
 * @param raw prototype dump
 * @param opts { entityName(proto), fluidName(proto), resolveIcon(proto, id): Promise<string>, itemSubtypes: string[] }
 * @returns {Promise<{ machines: Record<string, object>, recipes: Record<string, object> }>}
 */
export async function exportExtraction(raw, opts) {
  const { entityName, fluidName, resolveIcon, itemSubtypes } = opts
  const machines = {}
  const recipes = {}

  const lookupSubgroup = (id) => {
    if (!id) return ''
    for (const subtype of itemSubtypes) {
      const proto = raw[subtype]?.[id]
      if (proto) return proto.subgroup ?? ''
    }
    return raw.fluid?.[id]?.subgroup ?? ''
  }

  // --- Mining drills and resources ---------------------------------------
  const drills = Object.values(raw['mining-drill'] ?? {}).map(proto => ({
    proto,
    categories: luaList(proto.resource_categories),
    hasFluidInput: Boolean(proto.input_fluid_box),
  }))
  const usedDrills = new Set()

  for (const resource of Object.values(raw.resource ?? {})) {
    const minable = resource.minable
    if (!minable || !(minable.mining_time > 0)) continue
    const products = resourceProducts(minable)
    if (products.length === 0) continue

    const resourceCategory = resource.category ?? DEFAULT_RESOURCE_CATEGORY
    const requiresFluid = typeof minable.required_fluid === 'string' && minable.required_fluid !== ''
    const category = (requiresFluid ? MINING_FLUID_PREFIX : MINING_PREFIX) + resourceCategory
    const ingredients = []
    if (requiresFluid) {
      const amount = (minable.fluid_amount ?? 0) / 10
      if (amount > 0) ingredients.push({ itemId: minable.required_fluid, type: 'fluid', amount })
    }

    const capable = drills.filter(d =>
      d.categories.includes(resourceCategory) && (!requiresFluid || d.hasFluidInput))
    if (capable.length === 0) continue
    for (const d of capable) usedDrills.add(d.proto.name)

    const id = `mining:${resource.name}`
    const mainProduct = products.length === 1 ? products[0].itemId : undefined
    const entry = {
      id,
      name:              `${entityName(resource)} (mining)`,
      category,
      craftingTime:      minable.mining_time,
      ingredients,
      products,
      madeIn:            capable.map(d => d.proto.name).sort(),
      allowProductivity: true,
      hidden:            Boolean(resource.hidden) || capable.every(d => d.proto.hidden),
      subgroup:          lookupSubgroup(mainProduct),
      order:             resource.order ?? '',
      extraction:        true,
    }
    if (mainProduct !== undefined) entry.mainProduct = mainProduct
    recipes[id] = entry
  }

  for (const { proto, categories, hasFluidInput } of drills) {
    if (!usedDrills.has(proto.name)) continue
    const craftingCategories = categories.map(c => MINING_PREFIX + c)
    if (hasFluidInput) craftingCategories.push(...categories.map(c => MINING_FLUID_PREFIX + c))
    machines[proto.name] = {
      id:                proto.name,
      name:              entityName(proto),
      type:              'mining-drill',
      craftingSpeed:     proto.mining_speed ?? 1,
      ...machineEnergy(proto),
      moduleSlots:       proto.module_slots ?? 0,
      allowedEffects:    proto.allowed_effects == null
        ? ALL_EFFECTS.slice()
        : luaList(proto.allowed_effects).slice().sort(),
      craftingCategories: [...new Set(craftingCategories)].sort(),
      iconPath:          await resolveIcon(proto, proto.name),
      hidden:            proto.hidden ?? false,
    }
  }

  // --- Offshore pumps ----------------------------------------------------
  const pumpsByFluid = {}
  for (const proto of Object.values(raw['offshore-pump'] ?? {})) {
    const fluids = offshorePumpFluids(proto, raw).filter(f => raw.fluid?.[f])
    if (fluids.length === 0) continue
    for (const f of fluids) (pumpsByFluid[f] ??= []).push(proto)
    machines[proto.name] = {
      id:                proto.name,
      name:              entityName(proto),
      type:              'offshore-pump',
      craftingSpeed:     proto.pumping_speed ?? 1,
      ...machineEnergy(proto),
      moduleSlots:       0,
      allowedEffects:    [],
      craftingCategories: fluids.map(f => OFFSHORE_PREFIX + f).sort(),
      iconPath:          await resolveIcon(proto, proto.name),
      hidden:            proto.hidden ?? false,
    }
  }

  for (const [fluid, pumps] of Object.entries(pumpsByFluid)) {
    const id = OFFSHORE_PREFIX + fluid
    recipes[id] = {
      id,
      name:              `${fluidName(raw.fluid[fluid])} (offshore pump)`,
      category:          id,
      craftingTime:      1,
      ingredients:       [],
      products:          [{ itemId: fluid, type: 'fluid', amount: 60 }],
      madeIn:            pumps.map(p => p.name).sort(),
      allowProductivity: false,
      hidden:            pumps.every(p => p.hidden),
      subgroup:          lookupSubgroup(fluid),
      order:             '',
      extraction:        true,
      mainProduct:       fluid,
    }
  }

  return { machines, recipes }
}
