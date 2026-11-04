import { describe, it, expect } from 'vitest'
import { applyRecipeConstraints } from './EditMachineModal'

const totals = () => ({ speed: 1, productivity: 0.4, consumption: -0.2, pollution: 0.1, quality: 0.3 })

describe('applyRecipeConstraints', () => {
  it('drops an effect missing from any known list, as the solver does', () => {
    const fx = applyRecipeConstraints(totals(), [['speed', 'productivity'], ['speed', 'consumption']], true)
    expect(fx).toEqual({ speed: 1, productivity: 0, consumption: 0, pollution: 0, quality: 0 })
  })

  it('treats an unknown entity (undefined list) as filtering nothing', () => {
    expect(applyRecipeConstraints(totals(), [undefined, undefined], true)).toEqual(totals())
  })

  it('treats a known empty list as allowing nothing', () => {
    expect(applyRecipeConstraints(totals(), [[]], true)).toEqual(
      { speed: 0, productivity: 0, consumption: 0, pollution: 0, quality: 0 })
  })

  it('drops productivity when the recipe disallows it', () => {
    expect(applyRecipeConstraints(totals(), [undefined], false).productivity).toBe(0)
  })
})
