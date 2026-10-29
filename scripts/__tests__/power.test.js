import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  exportPower, parsePowerRecipeId, powerRecipeName, isPowerCategory, isScriptPlacedGenerator,
  ELECTRICITY_ITEM_ID, POWER_GROUP_ID, POWER_SUBGROUPS, POWER_MACHINE_TYPES,
} from '../power.js'
import { computeDefaultMachines } from '../extraction.js'
import { ELECTRICITY_ITEM_ID as TS_ELECTRICITY_ITEM_ID } from '../../src/data/electricity'

const fluid = (name, extra = {}) => ({ name, heat_capacity: '0.2kJ', default_temperature: 15, ...extra })

// Each call returns a fresh dump.
function makeRaw() {
  return {
    fluid: {
      water: fluid('water'),
      steam: fluid('steam', { max_temperature: 5000 }),
      'crude-oil': fluid('crude-oil', { default_temperature: 25, heat_capacity: undefined, fuel_value: '0.5MJ' }),
      'hidden-oil': fluid('hidden-oil', { hidden: true, fuel_value: '1MJ' }),
      'nullius-energy': fluid('nullius-energy', { hidden: true, heat_capacity: '0.1kJ', default_temperature: 100, fuel_value: '10kJ' }),
    },
    item: {
      coal: { name: 'coal', fuel_category: 'chemical', fuel_value: '4MJ' },
      'solid-fuel': { name: 'solid-fuel', fuel_category: 'chemical', fuel_value: '12MJ' },
      'wood-chip': { name: 'wood-chip', fuel_category: 'chemical', fuel_value: '1MJ', burnt_result: 'ash' },
      'hidden-fuel': { name: 'hidden-fuel', hidden: true, fuel_category: 'chemical', fuel_value: '5MJ' },
      'fuel-cell': { name: 'fuel-cell', fuel_category: 'nuclear', fuel_value: '8GJ' },
      rock: { name: 'rock' },
      ash: { name: 'ash' },
    },
    boiler: {
      boiler: {
        name: 'boiler', target_temperature: 165, mode: 'output-to-separate-pipe',
        fluid_box: { filter: 'water' }, output_fluid_box: { filter: 'steam' },
        energy_consumption: '1.8MW', energy_source: { type: 'burner', fuel_categories: ['chemical'] },
      },
      'half-boiler': {
        name: 'half-boiler', target_temperature: 165,
        fluid_box: { filter: 'water' }, output_fluid_box: { filter: 'steam' },
        energy_consumption: '1MW', energy_source: { type: 'burner', fuel_categories: ['chemical'], effectivity: 0.5 },
      },
      'oil-boiler': {
        name: 'oil-boiler', target_temperature: 315,
        fluid_box: { filter: 'water' }, output_fluid_box: { filter: 'steam' },
        energy_consumption: '5.4MW', energy_source: { type: 'fluid', burns_fluid: true, scale_fluid_usage: true },
      },
      'heat-exchanger': {
        name: 'heat-exchanger', target_temperature: 500,
        fluid_box: { filter: 'water' }, output_fluid_box: { filter: 'steam' },
        energy_consumption: '10MW', energy_source: { type: 'heat' },
      },
      'hidden-boiler': {
        name: 'hidden-boiler', hidden: true, target_temperature: 165,
        fluid_box: { filter: 'water' }, output_fluid_box: { filter: 'steam' },
        energy_consumption: '1MW', energy_source: { type: 'burner' },
      },
    },
    generator: {
      'steam-engine': {
        name: 'steam-engine', effectivity: 1, fluid_usage_per_tick: 0.5, maximum_temperature: 165,
        fluid_box: { filter: 'steam' }, minable: { result: 'steam-engine' },
      },
      'steam-turbine': {
        name: 'steam-turbine', effectivity: 1, fluid_usage_per_tick: 1, maximum_temperature: 500,
        fluid_box: { filter: 'steam' }, minable: { result: 'steam-turbine' },
      },
      'capped-engine': {
        name: 'capped-engine', effectivity: 1, fluid_usage_per_tick: 0.5, maximum_temperature: 165,
        max_power_output: '0.5MW', fluid_box: { filter: 'steam' }, minable: { result: 'capped-engine' },
      },
      'turbine-generator': {
        name: 'turbine-generator', hidden: true, effectivity: 0.9, fluid_usage_per_tick: 2,
        burns_fluid: true, scale_fluid_usage: true, max_power_output: '1MW',
        fluid_box: { filter: 'nullius-energy' },
      },
      'petroleum-generator': {
        name: 'petroleum-generator', hidden: true, burns_fluid: true, fluid_usage_per_tick: 1,
        minable: { result: 'petroleum-generator' },
      },
      'oil-generator': {
        name: 'oil-generator', burns_fluid: true, fluid_usage_per_tick: 0.05,
        max_power_output: '0.016666666666667MJ', minable: { result: 'oil-generator' },
      },
    },
    'burner-generator': {
      'burner-gen': {
        name: 'burner-gen', max_power_output: '1MW', burner: { type: 'burner', fuel_categories: ['chemical'], effectivity: 0.5 },
      },
    },
    'solar-panel': { 'solar-panel': { name: 'solar-panel', production: '60kW' } },
    'virtual-signal': { 'signal-lightning': { name: 'signal-lightning', icon: 'x.png' } },
  }
}

function makeOpts() {
  return {
    entityName: p => p.name,
    itemName: p => p.name,
    fluidName: p => p.name,
    resolveIcon: vi.fn(async (_proto, id) => `/icons/${id}.png`),
    itemSubtypes: ['item'],
  }
}

afterEach(() => { vi.restoreAllMocks() })

const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {})
const amountOf = (list, itemId) => list.find(x => x.itemId === itemId)?.amount

describe('boilers', () => {
  it('makes one recipe per fuel with the steam and fuel rates of the boiler', async () => {
    quiet()
    const { recipes } = await exportPower(makeRaw(), makeOpts())
    const r = recipes['power:boiler:coal']
    expect(r).toMatchObject({
      id: 'power:boiler:coal', name: 'boiler (coal)', category: 'power:boiler', craftingTime: 1,
      madeIn: ['boiler'], power: true, mainProduct: 'steam', subgroup: 'power:boilers',
      allowProductivity: false, hidden: false, order: '',
    })
    expect(amountOf(r.ingredients, 'water')).toBeCloseTo(60, 9)
    expect(amountOf(r.ingredients, 'coal')).toBeCloseTo(0.45, 9)
    expect(r.ingredients.at(-1).itemId).toBe('coal')
    expect(r.products).toEqual([{ itemId: 'steam', type: 'fluid', amount: expect.closeTo(60, 9) }])
    expect(amountOf(recipes['power:boiler:solid-fuel'].ingredients, 'solid-fuel')).toBeCloseTo(0.15, 9)
    const half = recipes['power:half-boiler:coal']
    expect(amountOf(half.ingredients, 'coal')).toBeCloseTo(0.5, 9)
    expect(amountOf(half.products, 'steam')).toBeCloseTo(1000 / 30, 9)
  })

  it('skips hidden fuels, other fuel categories and items without fuel value; adds burnt results', async () => {
    quiet()
    const { recipes } = await exportPower(makeRaw(), makeOpts())
    expect(recipes['power:boiler:hidden-fuel']).toBeUndefined()
    expect(recipes['power:boiler:fuel-cell']).toBeUndefined()
    expect(recipes['power:boiler:rock']).toBeUndefined()
    const wood = recipes['power:boiler:wood-chip']
    expect(amountOf(wood.products, 'ash')).toBeCloseTo(1.8, 9)
  })

  it('burns fluids in a fluid boiler', async () => {
    quiet()
    const { recipes } = await exportPower(makeRaw(), makeOpts())
    const r = recipes['power:oil-boiler:crude-oil']
    expect(amountOf(r.products, 'steam')).toBeCloseTo(90, 9)
    expect(amountOf(r.ingredients, 'crude-oil')).toBeCloseTo(10.8, 9)
    expect(r.ingredients.at(-1)).toMatchObject({ itemId: 'crude-oil', type: 'fluid' })
    expect(recipes['power:oil-boiler:hidden-oil']).toBeUndefined()
  })

  it('warns once about a heat boiler and skips hidden boilers silently', async () => {
    const warn = quiet()
    const { recipes, machines } = await exportPower(makeRaw(), makeOpts())
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('heat-exchanger')
    expect(Object.keys(recipes).some(id => id.includes('heat-exchanger'))).toBe(false)
    expect(machines['heat-exchanger']).toBeUndefined()
    expect(Object.keys(recipes).some(id => id.includes('hidden-boiler'))).toBe(false)
  })
})

describe('fluid generators', () => {
  it('computes steam engines and turbines from temperature and heat capacity', async () => {
    quiet()
    const { recipes } = await exportPower(makeRaw(), makeOpts())
    const engine = recipes['power:steam-engine:steam']
    expect(engine.ingredients).toEqual([{ itemId: 'steam', type: 'fluid', amount: 30, minimumTemperature: 165 }])
    expect(amountOf(engine.products, ELECTRICITY_ITEM_ID)).toBeCloseTo(0.9, 9)
    expect(engine).toMatchObject({ subgroup: 'power:generators', mainProduct: ELECTRICITY_ITEM_ID })
    const turbine = recipes['power:steam-turbine:steam']
    expect(amountOf(turbine.ingredients, 'steam')).toBeCloseTo(60, 9)
    expect(amountOf(turbine.products, ELECTRICITY_ITEM_ID)).toBeCloseTo(5.82, 9)
  })

  it('caps the output and keeps the full usage without scale_fluid_usage', async () => {
    quiet()
    const { recipes } = await exportPower(makeRaw(), makeOpts())
    const r = recipes['power:capped-engine:steam']
    expect(amountOf(r.ingredients, 'steam')).toBeCloseTo(30, 9)
    expect(amountOf(r.products, ELECTRICITY_ITEM_ID)).toBeCloseTo(0.5, 9)
  })

  it('handles the Nullius shape: hidden, not minable, burns a hidden filter fluid, scaled usage', async () => {
    quiet()
    const raw = makeRaw()
    expect(isScriptPlacedGenerator(raw.generator['turbine-generator'])).toBe(true)
    expect(isScriptPlacedGenerator(raw.generator['petroleum-generator'])).toBe(false)
    const { recipes, machines } = await exportPower(raw, makeOpts())
    const r = recipes['power:turbine-generator:nullius-energy']
    expect(r.ingredients).toHaveLength(1)
    expect(r.ingredients[0].amount).toBeCloseTo(111.111111, 5)
    expect(r.ingredients[0].minimumTemperature).toBeUndefined()
    expect(amountOf(r.products, ELECTRICITY_ITEM_ID)).toBeCloseTo(1, 9)
    expect(machines['turbine-generator']).toMatchObject({ hidden: false, type: 'generator' })

    const variant = makeRaw()
    variant.generator['turbine-generator'].effectivity = 0.85
    const v = await exportPower(variant, makeOpts())
    expect(v.recipes['power:turbine-generator:nullius-energy'].ingredients[0].amount).toBeCloseTo(117.647, 3)
  })

  it('burns each visible fluid fuel in a generator without a filter', async () => {
    quiet()
    const { recipes } = await exportPower(makeRaw(), makeOpts())
    const ids = Object.keys(recipes).filter(id => id.startsWith('power:oil-generator'))
    expect(ids).toEqual(['power:oil-generator:crude-oil'])
    const r = recipes[ids[0]]
    expect(amountOf(r.ingredients, 'crude-oil')).toBeCloseTo(3, 9)
    expect(amountOf(r.products, ELECTRICITY_ITEM_ID)).toBeCloseTo(1, 9)
    expect(Object.keys(recipes).some(id => id.includes('petroleum-generator'))).toBe(false)
  })
})

describe('burner generators and solar panels', () => {
  it('turns fuel into electricity, with burnt results', async () => {
    quiet()
    const { recipes } = await exportPower(makeRaw(), makeOpts())
    expect(amountOf(recipes['power:burner-gen:coal'].ingredients, 'coal')).toBeCloseTo(0.5, 9)
    expect(amountOf(recipes['power:burner-gen:coal'].products, ELECTRICITY_ITEM_ID)).toBeCloseTo(1, 9)
    expect(amountOf(recipes['power:burner-gen:solid-fuel'].ingredients, 'solid-fuel')).toBeCloseTo(1 / 6, 5)
    const wood = recipes['power:burner-gen:wood-chip']
    expect(amountOf(wood.ingredients, 'wood-chip')).toBeCloseTo(2, 9)
    expect(amountOf(wood.products, 'ash')).toBeCloseTo(2, 9)
    expect(wood.subgroup).toBe('power:burner-generators')
  })

  it('gives a solar panel no ingredients and 70 % of its peak', async () => {
    quiet()
    const { recipes } = await exportPower(makeRaw(), makeOpts())
    const r = recipes['power:solar-panel']
    expect(r.ingredients).toEqual([])
    expect(amountOf(r.products, ELECTRICITY_ITEM_ID)).toBeCloseTo(0.042, 9)
    expect(r.name).toBe('solar-panel')
    expect(r.subgroup).toBe('power:solar-panels')
  })
})

describe('machines', () => {
  it('draw no power, run at speed 1 and exist only when they have a recipe', async () => {
    quiet()
    const { machines, recipes } = await exportPower(makeRaw(), makeOpts())
    for (const m of Object.values(machines)) {
      expect(m).toMatchObject({
        energyUsageKw: 0, drainKw: 0, energyType: 'void', craftingSpeed: 1,
        craftingCategories: [`power:${m.id}`], moduleSlots: 0, allowedEffects: [], hidden: false,
      })
      expect(POWER_MACHINE_TYPES).toContain(m.type)
    }
    const withRecipes = new Set(Object.values(recipes).flatMap(r => r.madeIn))
    expect(new Set(Object.keys(machines))).toEqual(withRecipes)
  })
})

describe('electricity item and groups', () => {
  it('emits the item, the group and the used subgroups', async () => {
    quiet()
    const { items, itemGroups, itemSubgroups } = await exportPower(makeRaw(), makeOpts())
    expect(items[ELECTRICITY_ITEM_ID]).toEqual({
      id: 'power:electricity', name: 'Electricity', type: 'fluid', iconPath: '/icons/power-electricity.png',
      hidden: false, subgroup: 'power:electricity', order: 'a',
    })
    expect(itemGroups[POWER_GROUP_ID]).toEqual({ id: 'power:power', name: 'Power', order: 'zz', iconPath: '/icons/power-electricity.png' })
    expect(Object.keys(itemSubgroups).sort()).toEqual(Object.values(POWER_SUBGROUPS).sort())
    expect(itemSubgroups['power:boilers']).toEqual({ id: 'power:boilers', group: 'power:power', order: 'b' })
  })

  it('emits nothing without power prototypes', async () => {
    const result = await exportPower({ fluid: {}, item: {} }, makeOpts())
    expect(result).toEqual({ machines: {}, recipes: {}, items: {}, itemGroups: {}, itemSubgroups: {} })
  })
})

describe('helpers', () => {
  it('parses and names power recipe ids', () => {
    expect(parsePowerRecipeId('power:boiler:coal')).toEqual({ machineId: 'boiler', inputId: 'coal' })
    expect(parsePowerRecipeId('power:solar-panel')).toEqual({ machineId: 'solar-panel', inputId: undefined })
    expect(powerRecipeName('Boiler', 'Coal')).toBe('Boiler (Coal)')
    expect(powerRecipeName('Solar panel')).toBe('Solar panel')
    expect(isPowerCategory('power:boiler')).toBe(true)
    expect(isPowerCategory('mining:basic-solid')).toBe(false)
  })

  it('shares the electricity id with the app', () => {
    expect(ELECTRICITY_ITEM_ID).toBe(TS_ELECTRICITY_ITEM_ID)
  })

  it('picks the machine of each power category as default', async () => {
    quiet()
    const { machines } = await exportPower(makeRaw(), makeOpts())
    const categoryMap = {}
    for (const m of Object.values(machines)) {
      for (const c of m.craftingCategories) (categoryMap[c] ??= []).push(m.id)
    }
    const defaults = computeDefaultMachines(machines, categoryMap)
    for (const m of Object.values(machines)) expect(defaults[`power:${m.id}`]).toBe(m.id)
  })
})
