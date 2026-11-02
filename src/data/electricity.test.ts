import { describe, it, expect } from 'vitest'
import { isEnergyItem } from './electricity'

describe('isEnergyItem', () => {
  it('is true for electricity and heat', () => {
    expect(isEnergyItem('power:electricity')).toBe(true)
    expect(isEnergyItem('power:heat')).toBe(true)
  })

  it('is false for anything else', () => {
    expect(isEnergyItem('steam')).toBe(false)
    expect(isEnergyItem(undefined)).toBe(false)
  })
})
