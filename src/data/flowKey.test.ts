import { describe, it, expect } from 'vitest'
import { compareTags, fitsRange, flowKey, fmtFluidTag, keysOfItem, offerByItem, parseFlowKey, productTag, rangeDepth, rangeOf, splitFluids, sumByItem, sumOfItem, versatility } from './flowKey'
import type { FluidTag, GameData } from './types'

describe('flowKey and parseFlowKey', () => {
  const cases: [string, string, FluidTag | undefined][] = [
    ['plain', 'steam', undefined],
    ['a temperature', 'steam@165', { at: 165 }],
    ['an unknown temperature', 'steam@?', { at: null }],
    ['a minimum', 'steam[465,]', { min: 465 }],
    ['a maximum', 'steam[,50]', { max: 50 }],
    ['both bounds', 'steam[125,165]', { min: 125, max: 165 }],
    ['any', 'steam[,]', {}],
    ['a fractional temperature', 'steam@0.5', { at: 0.5 }],
    ['a negative temperature', 'steam@-10', { at: -10 }],
    ['heat', 'power:heat@?', { at: null }],
  ]
  for (const [name, key, tag] of cases) {
    it(`${name}: ${key}`, () => {
      const id = key.replace(/[@[].*$/, '')
      expect(flowKey(id, tag)).toBe(key)
      expect(parseFlowKey(key)).toStrictEqual(tag === undefined ? { itemId: id } : { itemId: id, tag })
    })
  }
})

describe('fitsRange', () => {
  it('a made temperature', () => {
    expect(fitsRange({ at: 465 }, { min: 465 })).toBe(true)
    expect(fitsRange({ at: 465 - 1e-10 }, { min: 465 })).toBe(true)
    expect(fitsRange({ at: 464.9 }, { min: 465 })).toBe(false)
    expect(fitsRange({ at: null }, { min: 465 })).toBe(true)
    expect(fitsRange({ at: 51 }, { max: 50 })).toBe(false)
    expect(fitsRange({ at: 25 }, {})).toBe(true)
  })

  it('a range lies inside the range', () => {
    expect(fitsRange({ min: 500 }, { min: 465 })).toBe(true)
    expect(fitsRange({ min: 465 }, { min: 500 })).toBe(false)
    expect(fitsRange({ min: 100, max: 200 }, { min: 50, max: 250 })).toBe(true)
    expect(fitsRange({ min: 100 }, { min: 50, max: 250 })).toBe(false)
    expect(fitsRange({}, {})).toBe(true)
    expect(fitsRange({ max: 30 }, {})).toBe(true)
    expect(fitsRange({}, { max: 30 })).toBe(false)
  })
})

describe('fmtFluidTag', () => {
  it('labels a temperature or a range', () => {
    expect(fmtFluidTag({ at: 500 })).toBe('500°C')
    expect(fmtFluidTag({ min: 465 })).toBe('≥465°C')
    expect(fmtFluidTag({ max: 50 })).toBe('≤50°C')
    expect(fmtFluidTag({ min: 125, max: 165 })).toBe('125–165°C')
    expect(fmtFluidTag({ min: 165, max: 165 })).toBe('165°C')
  })

  it('is empty for no tag, an unknown temperature or any', () => {
    expect(fmtFluidTag({})).toBe('')
    expect(fmtFluidTag({ at: null })).toBe('')
    expect(fmtFluidTag(undefined)).toBe('')
  })
})

describe('rangeOf and productTag', () => {
  it('keeps the sides with a real bound', () => {
    expect(rangeOf({ minimumTemperature: 465, maximumTemperature: 1.79e308 })).toStrictEqual({ min: 465 })
    expect(rangeOf({ minimumTemperature: -1e30 })).toStrictEqual({})
  })

  it('a product is made at its temperature, else the default, else unknown; heat is unknown', () => {
    expect(productTag({ itemId: 'steam', temperature: 500 }, { defaultTemperature: 165 })).toStrictEqual({ at: 500 })
    expect(productTag({ itemId: 'steam' }, { defaultTemperature: 165 })).toStrictEqual({ at: 165 })
    expect(productTag({ itemId: 'steam' }, undefined)).toStrictEqual({ at: null })
    expect(productTag({ itemId: 'power:heat', temperature: 500 }, undefined)).toStrictEqual({ at: null })
  })
})

describe('splitFluids', () => {
  const data = (min?: number, max?: number) => ({
    recipes: { r: { ingredients: [{ itemId: 'steam', type: 'fluid', amount: 1, minimumTemperature: min, maximumTemperature: max }, { itemId: 'plate', type: 'item', amount: 1 }], products: [] } },
  }) as unknown as GameData

  it('lists the fluids with a real bound, once per data set', () => {
    const d = data(465)
    expect([...splitFluids(d)]).toEqual(['steam'])
    expect(splitFluids(d)).toBe(splitFluids(d))
  })

  it('does not split on an unbounded side', () => {
    expect(splitFluids(data(-1e30, 1e30)).size).toBe(0)
    expect(splitFluids(data(undefined, 1.79e308)).size).toBe(0)
  })
})

describe('sumByItem and offerByItem', () => {
  const map = new Map([['steam@165', 3600], ['steam[465,]', -3600], ['steam@500', 100], ['plate', -5]])

  it('sumByItem adds the keys of an item, signed', () => {
    expect([...sumByItem(map)]).toEqual([['steam', 100], ['plate', -5]])
  })

  it('offerByItem adds the positive part of a flow key and keeps a plain item as it is', () => {
    expect([...offerByItem(map)]).toEqual([['steam', 3700], ['plate', -5]])
  })
})

describe('compareTags, versatility, rangeDepth', () => {
  it('lists temperatures ascending (unknown last), then ranges by minimum (open first), then maximum (open last)', () => {
    const tags: FluidTag[] = [{ min: 465 }, { at: null }, {}, { at: 500 }, { max: 50 }, { at: 165 }, { min: 100, max: 200 }]
    expect([...tags].sort(compareTags)).toEqual([{ at: 165 }, { at: 500 }, { at: null }, { max: 50 }, {}, { min: 100, max: 200 }, { min: 465 }])
  })

  const ranges = [{ min: 465 }, {}, { min: 100, max: 200 }]
  it('versatility counts the ranges a tag fits', () => {
    expect(versatility({ at: 500 }, ranges)).toBe(2)
    expect(versatility({ at: 165 }, ranges)).toBe(2)
    expect(versatility({ at: 50 }, ranges)).toBe(1)
    expect(versatility({ at: null }, ranges)).toBe(3)
  })

  it('a narrower range is deeper', () => {
    expect(rangeDepth({ min: 465 }, ranges)).toBe(2)
    expect(rangeDepth({}, ranges)).toBe(1)
    expect(rangeDepth({ min: 100, max: 200 }, ranges)).toBe(2)
  })
})

describe('keysOfItem and sumOfItem', () => {
  const map = new Map([['steam@165', 3], ['steam[465,]', 5], ['water', 7], ['steam2@1', 11]])
  it('a split item: its keys', () => {
    expect(keysOfItem(map, 'steam')).toEqual(['steam@165', 'steam[465,]'])
    expect(sumOfItem(map, 'steam')).toBe(8)
  })
  it('a plain item: itself', () => {
    expect(keysOfItem(map, 'water')).toEqual(['water'])
    expect(sumOfItem(map, 'water')).toBe(7)
    expect(sumOfItem(map, 'none')).toBe(0)
  })
})
