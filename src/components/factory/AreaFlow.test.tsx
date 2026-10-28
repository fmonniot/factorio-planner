import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FlowChip } from './AreaFlow'
import type { GameData } from '../../data/types'

const items = {
  water: { id: 'water', name: 'Water', type: 'fluid', iconPath: '', hidden: false },
  hydrogen: { id: 'hydrogen', name: 'Hydrogen', type: 'fluid', iconPath: '', hidden: false },
} as unknown as GameData['items']

describe('FlowChip', () => {
  it('is a display-only span with the same title', () => {
    render(<FlowChip itemId="water" rate={60} boundary direction="receives" items={items} rateUnit="min" />)
    const chip = document.querySelector('[data-item-id="water"]')!
    expect(chip.tagName).toBe('SPAN')
    expect(chip).toHaveAttribute('title', 'Water: 60.0/m — from outside the block')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
