import { describe, it, expect } from 'vitest'
import { acceptsTemperature, effectiveTemperature, hasTemperatureBound } from './temperature'

describe('effectiveTemperature', () => {
  it('prefers the explicit temperature over the default', () => {
    expect(effectiveTemperature({ temperature: 165 }, { defaultTemperature: 15 })).toBe(165)
  })
  it('falls back to the default when the product states none', () => {
    expect(effectiveTemperature({}, { defaultTemperature: 15 })).toBe(15)
  })
  it('is undefined without either', () => {
    expect(effectiveTemperature({}, {})).toBeUndefined()
    expect(effectiveTemperature({}, undefined)).toBeUndefined()
  })
  it('is undefined for a non-finite value', () => {
    expect(effectiveTemperature({ temperature: NaN }, {})).toBeUndefined()
  })
})

describe('acceptsTemperature', () => {
  it('checks a minimum only', () => {
    expect(acceptsTemperature({ minimumTemperature: 165 }, 165), 'at min').toBe(true)
    expect(acceptsTemperature({ minimumTemperature: 165 }, 500), 'above').toBe(true)
    expect(acceptsTemperature({ minimumTemperature: 165 }, 164.99), 'below').toBe(false)
  })
  it('checks a maximum only', () => {
    expect(acceptsTemperature({ maximumTemperature: 30 }, 30), 'at max').toBe(true)
    expect(acceptsTemperature({ maximumTemperature: 30 }, 30.01), 'above').toBe(false)
  })
  it('checks both bounds', () => {
    const ing = { minimumTemperature: 125, maximumTemperature: 165 }
    expect(acceptsTemperature(ing, 150)).toBe(true)
    expect(acceptsTemperature(ing, 100), 'below').toBe(false)
    expect(acceptsTemperature(ing, 200), 'above').toBe(false)
  })
  it('treats +-1e308 as open', () => {
    const ing = { minimumTemperature: -1e308, maximumTemperature: 1e308 }
    expect(acceptsTemperature(ing, -1000)).toBe(true)
    expect(acceptsTemperature(ing, 1e6)).toBe(true)
    expect(hasTemperatureBound(ing), 'no real bound').toBe(false)
  })
  it('accepts exactly the value when min equals max', () => {
    const ing = { minimumTemperature: 50, maximumTemperature: 50 }
    expect(acceptsTemperature(ing, 50)).toBe(true)
    expect(acceptsTemperature(ing, 51)).toBe(false)
  })
})
