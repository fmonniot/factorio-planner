import { describe, expect, it } from 'vitest'
import { TIPPED_LABEL_CLASS, describedTip, tipProps, tippedLabel } from './tipProps'

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

describe('tippedLabel', () => {
  it('describes the text and makes the label focusable', () => {
    expect(tippedLabel('Hello')).toStrictEqual({ 'data-tip': 'Hello', 'aria-description': 'Hello', tabIndex: 0 })
  })
  it('has a class that shows the help cursor and a dotted underline', () => {
    expect(TIPPED_LABEL_CLASS).toContain('cursor-help')
    expect(TIPPED_LABEL_CLASS).toContain('border-dotted')
  })
})
