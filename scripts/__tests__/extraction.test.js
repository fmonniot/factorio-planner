import { describe, it, expect, vi } from 'vitest'
import { exportExtraction, computeDefaultMachines, isExtractionCategory, offshorePumpFluids, ALL_EFFECTS } from '../extraction.js'

// Each call returns a fresh dump.
function makeRaw() {
  return {
    'mining-drill': {
      'electric-drill': {
        name: 'electric-drill',
        mining_speed: 0.5,
        resource_categories: ['basic-solid'],
        energy_usage: '90kW',
        energy_source: { type: 'electric', drain: '0kW' },
        module_slots: 3,
        input_fluid_box: { production_type: 'input' },
      },
      'burner-drill': {
        name: 'burner-drill',
        mining_speed: 0.25,
        resource_categories: ['basic-solid'],
        energy_usage: '150kW',
        energy_source: { type: 'burner' },
        allowed_effects: {},
      },
      pumpjack: {
        name: 'pumpjack',
        mining_speed: 1,
        resource_categories: ['basic-fluid'],
        energy_usage: '90kW',
        energy_source: { type: 'electric' },
        output_fluid_box: {},
      },
      'hidden-drill': {
        name: 'hidden-drill',
        hidden: true,
        mining_speed: 1,
        resource_categories: ['hidden-only'],
        energy_usage: '10kW',
        energy_source: { type: 'electric' },
      },
      'unused-drill': {
        name: 'unused-drill',
        mining_speed: 1,
        resource_categories: ['nothing-here'],
        energy_usage: '10kW',
        energy_source: { type: 'electric' },
      },
    },
    resource: {
      'iron-ore': { name: 'iron-ore', order: 'a', minable: { mining_time: 1.2, result: 'iron-ore' } },
      'uranium-ore': {
        name: 'uranium-ore',
        minable: { mining_time: 2, result: 'uranium-ore', required_fluid: 'sulfuric-acid', fluid_amount: 10 },
      },
      'crude-oil': {
        name: 'crude-oil',
        category: 'basic-fluid',
        minable: {
          mining_time: 1,
          results: [{ type: 'fluid', name: 'crude-oil', amount_min: 10, amount_max: 10, probability: 1 }],
        },
      },
      'hidden-ore': { name: 'hidden-ore', hidden: true, minable: { mining_time: 1, result: 'iron-ore' } },
      'hidden-drill-ore': {
        name: 'hidden-drill-ore',
        category: 'hidden-only',
        minable: { mining_time: 1, result: 'iron-ore' },
      },
      'unmined-ore': { name: 'unmined-ore', category: 'no-drill', minable: { mining_time: 1, result: 'iron-ore' } },
      'no-minable': { name: 'no-minable' },
      'zero-time': { name: 'zero-time', minable: { mining_time: 0, result: 'iron-ore' } },
    },
    'offshore-pump': {
      'offshore-pump': {
        name: 'offshore-pump',
        pumping_speed: 20,
        energy_source: { type: 'void' },
        energy_usage: '1kW',
      },
      'filtered-pump': {
        name: 'filtered-pump',
        pumping_speed: 1,
        energy_source: { type: 'void' },
        fluid_box: { filter: 'crude-oil' },
      },
      'legacy-pump': {
        name: 'legacy-pump',
        pumping_speed: 2,
        energy_source: { type: 'void' },
        fluid: 'water',
      },
    },
    tile: {
      water: { name: 'water', fluid: 'water' },
      deepwater: { name: 'deepwater', fluid: 'water' },
      grass: { name: 'grass' },
    },
    fluid: {
      water: { name: 'water', subgroup: 'fluid' },
      'crude-oil': { name: 'crude-oil', subgroup: 'fluid' },
      'sulfuric-acid': { name: 'sulfuric-acid', subgroup: 'fluid' },
    },
    item: {
      'iron-ore': { name: 'iron-ore', subgroup: 'raw-resource' },
      'uranium-ore': { name: 'uranium-ore', subgroup: 'raw-resource' },
    },
  }
}

function makeOpts(overrides = {}) {
  return {
    entityName: p => p.name,
    fluidName: p => p.name,
    resolveIcon: async (_proto, id) => `/icons/${id}.png`,
    itemSubtypes: ['item'],
    ...overrides,
  }
}

describe('exportExtraction — mining recipes', () => {
  it('turns a resource with a single result into a mining recipe', async () => {
    const { recipes } = await exportExtraction(makeRaw(), makeOpts())
    const r = recipes['mining:iron-ore']
    expect(r.category).toBe('mining:basic-solid')
    expect(r.name).toBe('iron-ore (mining)')
    expect(r.craftingTime).toBe(1.2)
    expect(r.ingredients).toEqual([])
    expect(r.products).toEqual([{ itemId: 'iron-ore', type: 'item', amount: 1, probability: 1 }])
    expect(r.madeIn).toEqual(['burner-drill', 'electric-drill'])
    expect(r.extraction).toBe(true)
    expect(r.allowProductivity).toBe(true)
    expect(r.mainProduct).toBe('iron-ore')
    expect(r.subgroup).toBe('raw-resource')
    expect(r.order).toBe('a')
  })

  it('exports a fluid resource at its full amount', async () => {
    const { recipes } = await exportExtraction(makeRaw(), makeOpts())
    const r = recipes['mining:crude-oil']
    expect(r.category).toBe('mining:basic-fluid')
    expect(r.products).toMatchObject([{ itemId: 'crude-oil', type: 'fluid', amount: 10 }])
    expect(r.madeIn).toEqual(['pumpjack'])
  })

  it('makes a resource that needs a fluid a mining-with-fluid recipe for drills with a fluid input', async () => {
    const { recipes } = await exportExtraction(makeRaw(), makeOpts())
    const r = recipes['mining:uranium-ore']
    expect(r.category).toBe('mining-with-fluid:basic-solid')
    expect(r.ingredients).toEqual([{ itemId: 'sulfuric-acid', type: 'fluid', amount: 1 }])
    expect(r.madeIn).toEqual(['electric-drill'])
  })

  it('skips resources nothing can mine, without minable, or with no mining time', async () => {
    const { recipes } = await exportExtraction(makeRaw(), makeOpts())
    expect(recipes).not.toHaveProperty('mining:unmined-ore')
    expect(recipes).not.toHaveProperty('mining:no-minable')
    expect(recipes).not.toHaveProperty('mining:zero-time')
  })

  it('hides a recipe for a hidden resource or one only hidden drills mine', async () => {
    const { recipes } = await exportExtraction(makeRaw(), makeOpts())
    expect(recipes['mining:hidden-ore'].hidden).toBe(true)
    expect(recipes['mining:hidden-drill-ore'].hidden).toBe(true)
    expect(recipes['mining:iron-ore'].hidden).toBe(false)
  })
})

describe('exportExtraction — drills', () => {
  it('exports a drill with its categories, effects and energy', async () => {
    const { machines } = await exportExtraction(makeRaw(), makeOpts())
    const m = machines['electric-drill']
    expect(m.type).toBe('mining-drill')
    expect(m.craftingSpeed).toBe(0.5)
    expect(m.energyUsageKw).toBe(90)
    expect(m.energyType).toBe('electric')
    expect(m.moduleSlots).toBe(3)
    expect(m.allowedEffects).toEqual(ALL_EFFECTS)
    expect(m.craftingCategories).toEqual(['mining-with-fluid:basic-solid', 'mining:basic-solid'])
  })

  it('reads an empty allowed_effects as no effects', async () => {
    const { machines } = await exportExtraction(makeRaw(), makeOpts())
    expect(machines['burner-drill'].allowedEffects).toEqual([])
    expect(machines['burner-drill'].energyType).toBe('burner')
    expect(machines['burner-drill'].craftingCategories).toEqual(['mining:basic-solid'])
  })

  it('does not export a drill that mines nothing', async () => {
    const { machines } = await exportExtraction(makeRaw(), makeOpts())
    expect(machines).not.toHaveProperty('unused-drill')
    expect(machines).toHaveProperty('hidden-drill')
    expect(machines['hidden-drill'].hidden).toBe(true)
  })
})

describe('exportExtraction — offshore pumps', () => {
  it('exports an unfiltered pump for the distinct tile fluids', async () => {
    const { machines } = await exportExtraction(makeRaw(), makeOpts())
    const m = machines['offshore-pump']
    expect(m.type).toBe('offshore-pump')
    expect(m.craftingSpeed).toBe(20)
    expect(m.energyUsageKw).toBe(0)
    expect(m.energyType).toBe('void')
    expect(m.craftingCategories).toEqual(['offshore:water'])
  })

  it('makes one recipe per fluid, at 60 per pumping-speed unit', async () => {
    const { recipes } = await exportExtraction(makeRaw(), makeOpts())
    const r = recipes['offshore:water']
    expect(r.category).toBe('offshore:water')
    expect(r.name).toBe('water (offshore pump)')
    expect(r.craftingTime).toBe(1)
    expect(r.products).toEqual([{ itemId: 'water', type: 'fluid', amount: 60 }])
    expect(r.madeIn).toEqual(['legacy-pump', 'offshore-pump'])
    expect(r.extraction).toBe(true)
    expect(r.allowProductivity).toBe(false)
  })

  it('uses the filter, then proto.fluid, before the tiles', async () => {
    const { machines, recipes } = await exportExtraction(makeRaw(), makeOpts())
    expect(machines['filtered-pump'].craftingCategories).toEqual(['offshore:crude-oil'])
    expect(recipes['offshore:crude-oil'].madeIn).toEqual(['filtered-pump'])
    expect(machines['legacy-pump'].craftingCategories).toEqual(['offshore:water'])
    expect(offshorePumpFluids(makeRaw()['offshore-pump']['legacy-pump'], makeRaw())).toEqual(['water'])
  })
})

describe('exportExtraction — icons', () => {
  it('resolves the icon of each exported machine once', async () => {
    const raw = makeRaw()
    const resolveIcon = vi.fn(async (_proto, id) => `/icons/${id}.png`)
    const { machines } = await exportExtraction(raw, makeOpts({ resolveIcon }))
    expect(resolveIcon).toHaveBeenCalledTimes(Object.keys(machines).length)
    expect(resolveIcon).toHaveBeenCalledWith(raw['mining-drill']['electric-drill'], 'electric-drill')
    expect(machines['electric-drill'].iconPath).toBe('/icons/electric-drill.png')
    expect(machines['offshore-pump'].iconPath).toBe('/icons/offshore-pump.png')
  })
})

describe('isExtractionCategory', () => {
  it('recognises the generated categories only', () => {
    expect(isExtractionCategory('mining:basic-solid')).toBe(true)
    expect(isExtractionCategory('mining-with-fluid:basic-solid')).toBe(true)
    expect(isExtractionCategory('offshore:water')).toBe(true)
    expect(isExtractionCategory('crafting')).toBe(false)
    expect(isExtractionCategory('smelting')).toBe(false)
  })
})

describe('exportExtraction — edge cases', () => {
  it('skips a fluid-requiring resource without a positive fluid_amount, with a warning', async () => {
    const raw = makeRaw()
    raw.resource['bad-acid'] = {
      name: 'bad-acid',
      minable: { mining_time: 1, result: 'iron-ore', required_fluid: 'sulfuric-acid' },
    }
    raw.resource['zero-acid'] = {
      name: 'zero-acid',
      minable: { mining_time: 1, result: 'iron-ore', required_fluid: 'sulfuric-acid', fluid_amount: 0 },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { recipes } = await exportExtraction(raw, makeOpts())
    expect(recipes).not.toHaveProperty('mining:bad-acid')
    expect(recipes).not.toHaveProperty('mining:zero-acid')
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('exports no power for a drill whose energy source type maps to void', async () => {
    const raw = makeRaw()
    raw['mining-drill']['fluid-drill'] = {
      name: 'fluid-drill',
      mining_speed: 1,
      resource_categories: ['basic-solid'],
      energy_usage: '200kW',
      energy_source: { type: 'fluid' },
    }
    const { machines } = await exportExtraction(raw, makeOpts())
    expect(machines['fluid-drill'].energyType).toBe('void')
    expect(machines['fluid-drill'].energyUsageKw).toBe(0)
  })

  it('uses the expected value of a ranged product, and amount when given', async () => {
    const raw = makeRaw()
    raw.resource['ranged'] = {
      name: 'ranged',
      minable: { mining_time: 1, results: [
        { name: 'iron-ore', amount_min: 1, amount_max: 3, probability: 0.5 },
        { name: 'uranium-ore', amount: 4, amount_min: 1, amount_max: 9 },
        { name: 'only-max', amount_max: 5 },
      ] },
    }
    const { recipes } = await exportExtraction(raw, makeOpts())
    const [a, b, c] = recipes['mining:ranged'].products
    expect(a).toMatchObject({ amount: 2, probability: 0.5, amountMin: 1, amountMax: 3 })
    expect(b.amount).toBe(4)
    expect(c.amount).toBe(5)
  })
})

describe('computeDefaultMachines', () => {
  const machines = {
    fast: { craftingSpeed: 10, hidden: true },
    slow: { craftingSpeed: 1, hidden: false },
    allHiddenA: { craftingSpeed: 2, hidden: true },
    allHiddenB: { craftingSpeed: 3, hidden: true },
  }

  it('prefers visible machines in extraction categories', () => {
    const d = computeDefaultMachines(machines, { 'mining:basic-solid': ['fast', 'slow'] })
    expect(d['mining:basic-solid']).toBe('slow')
  })

  it('falls back to hidden machines when all are hidden', () => {
    const d = computeDefaultMachines(machines, { 'mining:x': ['allHiddenA', 'allHiddenB'] })
    expect(d['mining:x']).toBe('allHiddenB')
  })

  it('ignores hidden for other categories', () => {
    const d = computeDefaultMachines(machines, { crafting: ['fast', 'slow'] })
    expect(d.crafting).toBe('fast')
  })
})
