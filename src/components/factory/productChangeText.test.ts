import { describe, it, expect } from 'vitest'
import { productChangeTitle, productChangeRateText, productChangeLine } from './productChangeText'
import type { ProductChangeEffect } from '../../store/connections'

const effect = (over: Partial<ProductChangeEffect> = {}): ProductChangeEffect => ({
  connectionId: 'c',
  consumerId: 'g',
  consumerName: 'Gears',
  rate: 30,
  ...over,
})

describe('productChangeTitle', () => {
  it('names the item and block when making a product', () => {
    expect(productChangeTitle('add', 'Iron plate', 'Plates')).toBe('Make Iron plate a product of Plates?')
  })

  it('uses a bare apostrophe after a trailing s and \'s otherwise when removing', () => {
    expect(productChangeTitle('remove', 'Iron plate', 'Plates')).toBe("Remove Iron plate from Plates' products?")
    expect(productChangeTitle('remove', 'Iron plate', 'Gear')).toBe("Remove Iron plate from Gear's products?")
  })
})

describe('productChangeRateText', () => {
  it('formats per minute and per second, with a dash for no flow', () => {
    expect(productChangeRateText(30, 'min')).toBe('30.0/m')
    expect(productChangeRateText(30, 'sec')).toBe('0.50/s')
    expect(productChangeRateText(undefined, 'min')).toBe('—')
  })
})

describe('productChangeLine', () => {
  it('says a take will become a request', () => {
    expect(productChangeLine('add', effect(), 'Iron plate', '30.0/m')).toBe(
      'Gears takes existing Iron plate from this block (30.0/m). It will request it instead, so its needs will drive how much this block makes.',
    )
  })

  it('explains a request ignored because the block receives the item', () => {
    expect(productChangeLine('add', effect({ blocker: 'source-receives' }), 'Iron plate', '30.0/m')).toBe(
      'Gears takes existing Iron plate from this block (30.0/m). It would request it instead, but this block receives Iron plate itself, so it will still only take what is left over.',
    )
  })

  it('says a request will become a take when removing', () => {
    expect(productChangeLine('remove', effect(), 'Iron plate', '30.0/m')).toBe(
      'Gears requests Iron plate from this block (30.0/m). It will only take what is left over and no longer drive this block.',
    )
  })
})
