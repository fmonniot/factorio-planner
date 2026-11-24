import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FlowList } from './GroupPanel'
import { getAllByTip } from '../../../test/byTip'

const items = { steam: { id: 'steam', name: 'Steam', iconPath: '' } } as never

describe('FlowList', () => {
  it('names the temperature of each line of a split fluid', () => {
    const lines = [
      { key: 'steam@165', itemId: 'steam', temp: { at: 165 }, rate: 60, boundary: false, otherEnd: 'from Oil', ends: [] },
      { key: 'steam@500', itemId: 'steam', temp: { at: 500 }, rate: 30, boundary: false, otherEnd: '', ends: [] },
    ]
    render(<FlowList lines={lines} items={items} testId="area-receives" empty="none" />)
    expect(getAllByTip(/^Steam/).map(e => e.textContent)).toEqual(['Steam 165°C', 'Steam 500°C'])
  })
})
