import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ItemTile, fmtRate, fmtPower } from './ItemTile'
import { useUiStore } from '../../store/uiStore'
import type { Item } from '../../data/types'

// ---------------------------------------------------------------------------
// fmtRate
// ---------------------------------------------------------------------------

describe('fmtPower', () => {
  it('formats sub-kW values in W', () => {
    expect(fmtPower(0.5)).toEqual({ value: '500', unit: 'W' })
  })

  it('formats kW range', () => {
    expect(fmtPower(1)).toEqual({ value: '1.0', unit: 'kW' })
    expect(fmtPower(180)).toEqual({ value: '180.0', unit: 'kW' })
    expect(fmtPower(999)).toEqual({ value: '999.0', unit: 'kW' })
  })

  it('formats MW range', () => {
    expect(fmtPower(1000)).toEqual({ value: '1.0', unit: 'MW' })
    expect(fmtPower(2500)).toEqual({ value: '2.5', unit: 'MW' })
  })

  it('formats GW range', () => {
    expect(fmtPower(1_000_000)).toEqual({ value: '1.0', unit: 'GW' })
  })
})

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

  it('renders power in kW for electricity variant', () => {
    render(<ItemTile item={undefined} ratePerSec={180} variant="electricity" />)
    expect(screen.getByText(/180\.0/)).toBeInTheDocument()
    expect(screen.getByText('kW')).toBeInTheDocument()
  })

  it('renders power in MW for large electricity values', () => {
    render(<ItemTile item={undefined} ratePerSec={2500} variant="electricity" />)
    expect(screen.getByText(/2\.5/)).toBeInTheDocument()
    expect(screen.getByText('MW')).toBeInTheDocument()
  })

  it('electricity power display is independent of rateUnit', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    render(<ItemTile item={undefined} ratePerSec={180} variant="electricity" />)
    expect(screen.getByText(/180\.0/)).toBeInTheDocument()
    expect(screen.getByText('kW')).toBeInTheDocument()
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
