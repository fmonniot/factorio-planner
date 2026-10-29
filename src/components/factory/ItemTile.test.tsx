import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ItemTile, fmtRate, fmtPower, fmtItemRate, fmtItemRateText, inputRateUnit } from './ItemTile'
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
  it('keeps two significant digits for tiny non-zero rates', () => {
    expect(fmtRate(0.00082, 'sec')).toBe('0.00082')
    expect(fmtRate(0.0049, 'sec')).toBe('0.0049')
    expect(fmtRate(0.005, 'sec')).toBe('0.01')
    expect(fmtRate(0, 'sec')).toBe('0.00')
  })

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
  it('renders the temperature badge when given', () => {
    render(<ItemTile item={mockItem} ratePerSec={1} variant="ingredient" temperature="≥95°C" />)
    expect(screen.getByTestId('item-tile-temperature')).toHaveTextContent('≥95°C')
  })

  it('renders no temperature badge by default', () => {
    render(<ItemTile item={mockItem} ratePerSec={1} variant="ingredient" />)
    expect(screen.queryByTestId('item-tile-temperature')).toBeNull()
  })

  it('renders a sourcing badge and a title suffix when given a mode', () => {
    render(<ItemTile item={mockItem} ratePerSec={1} variant="ingredient" sourcing="connections-first" />)
    expect(screen.getByTestId('item-tile-sourcing')).toHaveTextContent('C')
    expect(screen.getByTitle('Iron Plate (connections first)')).toBeInTheDocument()
  })

  it('renders no sourcing badge by default', () => {
    render(<ItemTile item={mockItem} ratePerSec={1} variant="ingredient" />)
    expect(screen.queryByTestId('item-tile-sourcing')).toBeNull()
    expect(screen.getByTitle('Iron Plate')).toBeInTheDocument()
  })

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

  it('lets the tile title show on hover of the name when there is no icon', () => {
    render(<ItemTile item={mockItem} ratePerSec={1} variant="ingredient" title="Iron Plate (≥95°C)" />)
    const name = screen.getByText('Iron Plate')
    expect(name.getAttribute('title'), 'name span must not override the tile title').toBeNull()
    expect(name.closest('[title]')?.getAttribute('title')).toBe('Iron Plate (≥95°C)')
  })
})

describe('electricity rates', () => {
  const electricity: Item = {
    id: 'power:electricity', name: 'Electricity', type: 'fluid', iconPath: '', hidden: false, subgroup: '', order: '',
  }

  it('formats electricity in power units, 1 unit/s being 1 MW', () => {
    expect(fmtItemRate('power:electricity', 10, 'min')).toEqual({ value: '10.0', unit: 'MW' })
    expect(fmtItemRate('power:electricity', 0.042, 'sec')).toEqual({ value: '42.0', unit: 'kW' })
    expect(fmtItemRateText('power:electricity', 10, 'sec')).toBe('10.0MW')
  })

  it('formats other items by the rate unit', () => {
    expect(fmtItemRate('iron-plate', 1, 'min')).toEqual({ value: '60.0', unit: '/m' })
    expect(fmtItemRate('iron-plate', 1, 'sec')).toEqual({ value: '1.00', unit: '/s' })
  })

  it('types electricity in MW (rate unit sec) and everything else in the current unit', () => {
    expect(inputRateUnit('power:electricity', 'min')).toBe('sec')
    expect(inputRateUnit('iron-plate', 'min')).toBe('min')
  })

  it.each(['min', 'sec'] as const)('shows an electricity item tile with no icon as ⚡ and MW in %s', unit => {
    useUiStore.setState({ rateUnit: unit })
    const { container } = render(<ItemTile item={electricity} ratePerSec={10} variant="product" />)
    expect(screen.getByText('⚡')).toBeInTheDocument()
    expect(container.textContent).toContain('10.0MW')
    expect(container.querySelector('[data-variant="product"]')).not.toBeNull()
  })
})
