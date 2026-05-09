import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ItemTile, fmtRate } from './ItemTile'
import { useUiStore } from '../../store/uiStore'
import type { Item } from '../../data/types'

// ---------------------------------------------------------------------------
// fmtRate
// ---------------------------------------------------------------------------

describe('fmtRate', () => {
  it('formats per-sec rates in /sec mode', () => {
    expect(fmtRate(1, 'sec')).toBe('1.00')
    expect(fmtRate(10, 'sec')).toBe('10.0')
    expect(fmtRate(100, 'sec')).toBe('100')
  })

  it('converts per-sec to per-min when unit is min', () => {
    expect(fmtRate(1, 'min')).toBe('60.0')
    expect(fmtRate(1 / 60, 'min')).toBe('1.00')
    expect(fmtRate(2, 'min')).toBe('120')
  })
})

// ---------------------------------------------------------------------------
// ItemTile rendering
// ---------------------------------------------------------------------------

const mockItem: Item = {
  id: 'iron-plate',
  name: 'Iron Plate',
  type: 'item',
  iconPath: '',
  hidden: false,
  subgroup: '',
  order: '',
}

beforeEach(() => {
  useUiStore.setState({ rateUnit: 'min' })
})

describe('ItemTile', () => {
  it('renders rate in /min by default', () => {
    render(<ItemTile item={mockItem} ratePerSec={1} variant="ingredient" />)
    expect(screen.getByText(/60\.0/)).toBeInTheDocument()
  })

  it('renders rate in /sec when uiStore is set to sec', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    render(<ItemTile item={mockItem} ratePerSec={1} variant="ingredient" />)
    expect(screen.getByText(/1\.00/)).toBeInTheDocument()
  })

  it('renders electricity symbol for electricity variant with no item', () => {
    render(<ItemTile item={undefined} ratePerSec={5} variant="electricity" />)
    expect(screen.getByText('⚡')).toBeInTheDocument()
  })

  it('renders item name when no iconPath', () => {
    render(<ItemTile item={mockItem} ratePerSec={1} variant="product" />)
    expect(screen.getByText('Iron Plate')).toBeInTheDocument()
  })

  it('renders as a button when onClick is provided', () => {
    const handler = () => {}
    render(<ItemTile item={mockItem} ratePerSec={1} variant="byproduct" onClick={handler} />)
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('renders as a span when no onClick', () => {
    render(<ItemTile item={mockItem} ratePerSec={1} variant="product" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
