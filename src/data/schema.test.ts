import { describe, it, expect } from 'vitest'
import { ItemSchema } from './schema'

const base = { id: 'x', name: 'X', type: 'item', iconPath: '/i/x.png' }

describe('ItemSchema.iconColor', () => {
  it('keeps a valid colour', () => {
    expect(ItemSchema.parse({ ...base, iconColor: '#da1212' }).iconColor).toBe('#da1212')
  })

  it('reads a malformed colour as absent instead of failing the item', () => {
    for (const bad of ['#DA1212', '#fff', null, 42]) {
      expect(ItemSchema.parse({ ...base, iconColor: bad }).iconColor).toBeUndefined()
    }
  })
})
