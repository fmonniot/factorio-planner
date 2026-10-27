import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AreaListItem, FlowChip } from './AreaFlow'
import type { AreaRow } from './areaRows'
import type { GameData } from '../../data/types'

const items = {
  water: { id: 'water', name: 'Water', type: 'fluid', iconPath: '', hidden: false },
  hydrogen: { id: 'hydrogen', name: 'Hydrogen', type: 'fluid', iconPath: '', hidden: false },
} as unknown as GameData['items']

const rows: AreaRow[] = [
  {
    areaId: 'root',
    name: 'Top level',
    isRoot: true,
    receives: [{ itemId: 'water', rate: 60, boundary: true }],
    sends: [{ itemId: 'hydrogen', rate: 30, boundary: false }],
  },
  {
    areaId: 'p',
    name: 'Plastics',
    isRoot: false,
    receives: [{ itemId: 'hydrogen', rate: 30, boundary: false }],
    sends: [],
  },
]


describe('FlowChip without onSelect', () => {
  it('is a display-only span with the same title', () => {
    render(<FlowChip itemId="water" rate={60} boundary direction="receives" items={items} rateUnit="min" />)
    const chip = document.querySelector('[data-item-id="water"]')!
    expect(chip.tagName).toBe('SPAN')
    expect(chip).toHaveAttribute('title', 'Water: 60.0/m — from outside the block')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('AreaListItem', () => {
  const props = { items, rateUnit: 'min' as const, selectedItemId: null, onSelect: () => {} }

  it('shows the name as plain text without onOpen', () => {
    render(<ul><AreaListItem row={rows[1]} {...props} /></ul>)
    expect(screen.queryByRole('button', { name: 'Plastics' })).toBeNull()
  })

  it('makes the name a button with onOpen', () => {
    const onOpen = vi.fn()
    render(<ul><AreaListItem row={rows[1]} {...props} onOpen={onOpen} openTitle="Show Plastics" /></ul>)
    fireEvent.click(screen.getByRole('button', { name: 'Plastics' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.getByTitle('Show Plastics')).toBeInTheDocument()
  })
})
