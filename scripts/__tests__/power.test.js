import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  exportPower, parsePowerRecipeId, powerRecipeName, isPowerCategory, isScriptPlacedGenerator,
  ELECTRICITY_ITEM_ID, HEAT_ITEM_ID, POWER_ITEM_IDS, HEAT_ICON, POWER_GROUP_ID, POWER_SUBGROUPS, POWER_MACHINE_TYPES,
} from '../power.js'
import { computeDefaultMachines } from '../extraction.js'
import { ELECTRICITY_ITEM_ID as TS_ELECTRICITY_ITEM_ID, HEAT_ITEM_ID as TS_HEAT_ITEM_ID } from '../../src/data/electricity'

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
      'fuel-cell': { name: 'fuel-cell', fuel_category: 'nuclear', fuel_value: '8GJ', burnt_result: 'depleted-cell' },
      'depleted-cell': { name: 'depleted-cell' },
      rock: { name: 'rock' },
      ash: { name: 'ash' },
    },
    boiler: {
      boiler: {
        name: 'boiler', target_temperature: 165, mode: 'output-to-separate-pipe',
        fluid_box: { filter: 'water' }, output_fluid_box: { filter: 'steam' },
        energy_consumption: '1.8MW', energy_source: { type: 'burner', fuel_categories: ['chemical'], burnt_inventory_size: 1 },
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
      'electric-boiler': {
        name: 'electric-boiler', target_temperature: 165,
        fluid_box: { filter: 'water' }, output_fluid_box: { filter: 'steam' },
        energy_consumption: '1MW', energy_source: { type: 'electric' },
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
        name: 'burner-gen', max_power_output: '1MW', burner: { type: 'burner', fuel_categories: ['chemical'], effectivity: 0.5, burnt_inventory_size: 1 },
      },
    },
    reactor: {
      'nuclear-reactor': {
        name: 'nuclear-reactor', consumption: '40MW', neighbour_bonus: 1,
        energy_source: { type: 'burner', fuel_categories: ['nuclear'], effectivity: 1, burnt_inventory_size: 1 },
      },
      'burner-reactor': {
        name: 'burner-reactor', consumption: '0.6MW', neighbour_bonus: 0.25,
        energy_source: { type: 'burner', fuel_categories: ['chemical'], effectivity: 0.6 },
      },
      'fluid-reactor': {
        name: 'fluid-reactor', consumption: '0.8MW', neighbour_bonus: 0.1,
        energy_source: { type: 'fluid', burns_fluid: true, scale_fluid_usage: true, effectivity: 0.8 },
      },
      'default-bonus-reactor': {
        name: 'default-bonus-reactor', consumption: '1MW',
        energy_source: { type: 'burner', fuel_categories: ['chemical'] },
      },
      'geothermal-reactor': {
        name: 'geothermal-reactor', consumption: '10MW', neighbour_bonus: 0, energy_source: { type: 'void' },
      },
      'thermal-tank': {
        name: 'thermal-tank', consumption: '2kW', energy_source: { type: 'electric' },
      },
      'hidden-reactor': {
        name: 'hidden-reactor', hidden: true, consumption: '1MW',
        energy_source: { type: 'burner', fuel_categories: ['chemical'] },
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
    expect(r.products).toEqual([{ itemId: 'steam', type: 'fluid', amount: expect.closeTo(60, 9), temperature: 165 }])
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

  it('turns a heat exchanger into a recipe that consumes heat', async () => {
    quiet()
    const { recipes, machines } = await exportPower(makeRaw(), makeOpts())
    const r = recipes['power:heat-exchanger:power:heat']
    expect(r).toMatchObject({
      name: 'heat-exchanger (Heat)', category: 'power:heat-exchanger', mainProduct: 'steam',
      subgroup: 'power:boilers', power: true,
    })
    expect(amountOf(r.ingredients, 'water')).toBeCloseTo(10000 / 97, 4)
    expect(r.ingredients.at(-1)).toEqual({ itemId: 'power:heat', type: 'fluid', amount: 10 })
    expect(r.products).toEqual([{ itemId: 'steam', type: 'fluid', amount: expect.closeTo(10000 / 97, 4), temperature: 500 }])
    expect(machines['heat-exchanger'].type).toBe('boiler')
    expect(machines['heat-exchanger']).not.toHaveProperty('neighbourBonus')
  })

  it('puts the minimum working temperature of a heat exchanger on its heat ingredient', async () => {
    quiet()
    const raw = makeRaw()
    raw.boiler['heat-exchanger'].energy_source.min_working_temperature = 500
    const { recipes } = await exportPower(raw, makeOpts())
    expect(recipes['power:heat-exchanger:power:heat'].ingredients.at(-1))
      .toEqual({ itemId: 'power:heat', type: 'fluid', amount: 10, minimumTemperature: 500 })
  })

  it('ignores a non-finite minimum working temperature and never bounds a fuel', async () => {
    quiet()
    const raw = makeRaw()
    raw.boiler['heat-exchanger'].energy_source.min_working_temperature = 'hot'
    raw.boiler.boiler.energy_source.min_working_temperature = 500
    const { recipes } = await exportPower(raw, makeOpts())
    expect(recipes['power:heat-exchanger:power:heat'].ingredients.at(-1)).not.toHaveProperty('minimumTemperature')
    for (const ing of recipes['power:boiler:coal'].ingredients) expect(ing).not.toHaveProperty('minimumTemperature')
  })
})

describe('reactors', () => {
  it('turns fuel into heat and a burnt result', async () => {
    quiet()
    const { recipes, machines } = await exportPower(makeRaw(), makeOpts())
    const r = recipes['power:nuclear-reactor:fuel-cell']
    expect(r).toMatchObject({ mainProduct: 'power:heat', subgroup: 'power:reactors' })
    expect(r.ingredients).toEqual([{ itemId: 'fuel-cell', type: 'item', amount: expect.closeTo(0.005, 9) }])
    expect(amountOf(r.products, 'power:heat')).toBeCloseTo(40, 9)
    expect(amountOf(r.products, 'depleted-cell')).toBeCloseTo(0.005, 9)
    expect(recipes['power:nuclear-reactor:coal']).toBeUndefined()
    expect(machines['nuclear-reactor']).toMatchObject({ type: 'reactor', neighbourBonus: 1, energyUsageKw: 0, energyType: 'void' })
  })

  it('applies the effectivity and skips burnt-result and hidden fuels without a burnt inventory', async () => {
    quiet()
    const { recipes, machines } = await exportPower(makeRaw(), makeOpts())
    const r = recipes['power:burner-reactor:coal']
    expect(amountOf(r.ingredients, 'coal')).toBeCloseTo(0.25, 9)
    expect(amountOf(r.products, 'power:heat')).toBeCloseTo(0.6, 9)
    expect(recipes['power:burner-reactor:wood-chip']).toBeUndefined()
    expect(recipes['power:burner-reactor:hidden-fuel']).toBeUndefined()
    expect(machines['burner-reactor'].neighbourBonus).toBe(0.25)
  })

  it('burns fluids in a fluid reactor', async () => {
    quiet()
    const { recipes, machines } = await exportPower(makeRaw(), makeOpts())
    expect(Object.keys(recipes).filter(id => id.startsWith('power:fluid-reactor'))).toEqual(['power:fluid-reactor:crude-oil'])
    const r = recipes['power:fluid-reactor:crude-oil']
    expect(amountOf(r.ingredients, 'crude-oil')).toBeCloseTo(2, 9)
    expect(amountOf(r.products, 'power:heat')).toBeCloseTo(0.8, 9)
    expect(machines['fluid-reactor'].neighbourBonus).toBe(0.1)
  })

  it('stamps the heat buffer maximum temperature on the heat product', async () => {
    quiet()
    const raw = makeRaw()
    raw.reactor['burner-reactor'].heat_buffer = { max_temperature: 750 }
    raw.reactor['nuclear-reactor'].heat_buffer = { max_temperature: Infinity }
    const { recipes } = await exportPower(raw, makeOpts())
    const heat = id => recipes[id].products.find(p => p.itemId === 'power:heat')
    expect(heat('power:burner-reactor:coal').temperature).toBe(750)
    expect(heat('power:nuclear-reactor:fuel-cell')).not.toHaveProperty('temperature')
    expect(heat('power:fluid-reactor:crude-oil')).not.toHaveProperty('temperature')
    const burnt = recipes['power:nuclear-reactor:fuel-cell'].products.find(p => p.itemId === 'depleted-cell')
    expect(burnt).not.toHaveProperty('temperature')
  })

  it('leaves the heat temperature out when the heat buffer or its maximum is missing or not finite', async () => {
    quiet()
    const raw = makeRaw()
    delete raw.reactor['burner-reactor'].heat_buffer
    raw.reactor['nuclear-reactor'].heat_buffer = { max_temperature: '1000' }
    raw.reactor['fluid-reactor'].heat_buffer = { max_temperature: NaN }
    const { recipes } = await exportPower(raw, makeOpts())
    for (const id of ['power:burner-reactor:coal', 'power:nuclear-reactor:fuel-cell', 'power:fluid-reactor:crude-oil']) {
      expect(recipes[id].products.find(p => p.itemId === 'power:heat'), id).not.toHaveProperty('temperature')
    }
  })

  it('defaults the neighbour bonus to 1', async () => {
    quiet()
    const { machines } = await exportPower(makeRaw(), makeOpts())
    expect(machines['default-bonus-reactor'].neighbourBonus).toBe(1)
  })
})

describe('skipped prototypes', () => {
  it('warns about electric boilers and non-burning reactors, and skips hidden ones silently', async () => {
    const warn = quiet()
    const { recipes, machines } = await exportPower(makeRaw(), makeOpts())
    expect(warn).toHaveBeenCalledTimes(3)
    const messages = warn.mock.calls.map(c => c[0]).join('\n')
    for (const name of ['electric-boiler', 'geothermal-reactor', 'thermal-tank']) expect(messages).toContain(name)
    for (const name of ['electric-boiler', 'geothermal-reactor', 'thermal-tank', 'hidden-reactor', 'hidden-boiler']) {
      expect(Object.keys(recipes).some(id => id.startsWith(`power:${name}`)), name).toBe(false)
      expect(machines[name], name).toBeUndefined()
    }
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
    expect(r.name).toBe('solar-panel (electricity)')
    expect(r.subgroup).toBe('power:solar-panels')
  })
})

describe('burnt results and hidden fluid fuels', () => {
  it('skips fuels with a burnt result in a burner without a burnt inventory', async () => {
    quiet()
    const raw = makeRaw()
    raw.boiler.boiler.energy_source.burnt_inventory_size = 0
    delete raw['burner-generator']['burner-gen'].burner.burnt_inventory_size
    const { recipes } = await exportPower(raw, makeOpts())
    expect(recipes['power:boiler:wood-chip']).toBeUndefined()
    expect(recipes['power:boiler:coal']).toBeDefined()
    expect(recipes['power:burner-gen:wood-chip']).toBeUndefined()
    expect(recipes['power:burner-gen:coal']).toBeDefined()
  })

  it('skips a hidden fluid fuel named by a boiler filter', async () => {
    quiet()
    const raw = makeRaw()
    raw.boiler['oil-boiler'].energy_source.fluid_box = { filter: 'hidden-oil' }
    const { recipes } = await exportPower(raw, makeOpts())
    expect(Object.keys(recipes).some(id => id.startsWith('power:oil-boiler'))).toBe(false)
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

  it('emits the heat item and the reactors subgroup', async () => {
    quiet()
    const opts = makeOpts()
    const { items, itemSubgroups } = await exportPower(makeRaw(), opts)
    expect(items[HEAT_ITEM_ID]).toEqual({
      id: 'power:heat', name: 'Heat', type: 'fluid', iconPath: '/icons/power-heat.png',
      hidden: false, subgroup: 'power:electricity', order: 'b',
    })
    expect(opts.resolveIcon).toHaveBeenCalledWith(expect.objectContaining({ icon: HEAT_ICON, icon_size: 48 }), 'power-heat')
    expect(itemSubgroups['power:reactors']).toEqual({ id: 'power:reactors', group: 'power:power', order: 'f' })
  })

  it('emits no heat item without a heat recipe', async () => {
    quiet()
    const raw = makeRaw()
    delete raw.reactor
    delete raw.boiler['heat-exchanger']
    const { items, itemSubgroups } = await exportPower(raw, makeOpts())
    expect(Object.keys(items)).toEqual([ELECTRICITY_ITEM_ID])
    expect(itemSubgroups['power:reactors']).toBeUndefined()
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
    expect(powerRecipeName('Solar panel')).toBe('Solar panel (electricity)')
    expect(isPowerCategory('power:boiler')).toBe(true)
    expect(isPowerCategory('mining:basic-solid')).toBe(false)
  })

  it('shares the electricity and heat ids with the app', () => {
    expect(ELECTRICITY_ITEM_ID).toBe(TS_ELECTRICITY_ITEM_ID)
    expect(HEAT_ITEM_ID).toBe(TS_HEAT_ITEM_ID)
    expect(POWER_ITEM_IDS).toEqual(['power:electricity', 'power:heat'])
  })

  it('parses a heat exchanger id with a power: input', () => {
    expect(parsePowerRecipeId('power:heat-exchanger:power:heat')).toEqual({ machineId: 'heat-exchanger', inputId: 'power:heat' })
  })

  it('exports neighbourBonus on reactors only', async () => {
    quiet()
    const { machines } = await exportPower(makeRaw(), makeOpts())
    for (const m of Object.values(machines)) {
      if (m.type !== 'reactor') expect(m).not.toHaveProperty('neighbourBonus')
    }
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
