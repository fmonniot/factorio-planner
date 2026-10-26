import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { AreasPane } from './AreasPane'
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

const area = (name: string) => screen.getByRole('listitem', { name })
const chips = (itemId: string) => screen.getAllByRole('button').filter(b => b.dataset.itemId === itemId)

describe('AreasPane', () => {
  it('lists one item per area, named', () => {
    render(<AreasPane rows={rows} items={items} rateUnit="min" />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(area('Top level')).toBeInTheDocument()
    expect(area('Plastics')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Areas' }).textContent).toContain('· 2')
  })

  it('marks every chip with its item, direction and boundary', () => {
    render(<AreasPane rows={rows} items={items} rateUnit="min" />)
    const water = within(area('Top level')).getByTitle('Water: 60.0/m — from outside the block')
    expect(water.dataset).toMatchObject({ itemId: 'water', direction: 'receives', boundary: 'true' })
    const out = within(area('Top level')).getByTitle('Hydrogen: 30.0/m')
    expect(out.dataset).toMatchObject({ itemId: 'hydrogen', direction: 'sends', boundary: 'false' })
  })

  it('selecting a chip highlights the same item in every area and dims the rest', () => {
    render(<AreasPane rows={rows} items={items} rateUnit="min" />)
    fireEvent.click(within(area('Plastics')).getByTitle('Hydrogen: 30.0/m'))
    for (const chip of chips('hydrogen')) expect(chip).toHaveAttribute('aria-pressed', 'true')
    for (const chip of chips('water')) {
      expect(chip).toHaveAttribute('aria-pressed', 'false')
      expect(chip.className).toContain('opacity-40')
    }
    fireEvent.click(chips('hydrogen')[0])
    for (const chip of chips('hydrogen')) expect(chip).toHaveAttribute('aria-pressed', 'false')
  })

  it('collapses and expands', () => {
    render(<AreasPane rows={rows} items={items} rateUnit="min" />)
    const header = screen.getByRole('button', { name: /Areas/ })
    expect(header).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })
})
