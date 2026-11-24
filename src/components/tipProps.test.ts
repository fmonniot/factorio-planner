import { describe, expect, it } from 'vitest'
import { describedTip, tipProps } from './tipProps'

describe('tipProps', () => {
  it('names the element and shows its name as the tooltip', () => {
    expect(tipProps('Gear')).toStrictEqual({ 'aria-label': 'Gear', 'data-tip': '', 'aria-description': undefined })
  })
  it('shows and describes the detail', () => {
    expect(tipProps('Gear', 'Turns')).toStrictEqual({ 'aria-label': 'Gear', 'data-tip': 'Turns', 'aria-description': 'Turns' })
  })
})

describe('describedTip', () => {
  it('sets the tooltip and the description to the text', () => {
    expect(describedTip('Hello')).toStrictEqual({ 'data-tip': 'Hello', 'aria-description': 'Hello' })
  })
  it('gives nothing for empty or missing text', () => {
    expect(describedTip('')).toStrictEqual({})
    expect(describedTip(undefined)).toStrictEqual({})
  })
})
