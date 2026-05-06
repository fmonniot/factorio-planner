import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ItemPicker } from './ItemPicker'
import { useGameDataStore } from '../store/gameDataStore'
import type { GameData } from '../data/types'

// ---------------------------------------------------------------------------
// Fixture — a small but realistic GameData with recipes across two subgroups,
// a hidden recipe, and items spanning two groups via two subgroups.
// ---------------------------------------------------------------------------

const fixture: GameData = {
  factorioVersion: '2.0.0',
  modSet: {},
  items: {
    'iron-plate':  { id: 'iron-plate',  name: 'Iron Plate',  type: 'item',  iconPath: '', hidden: false, subgroup: 'raw-material', order: 'a' },
    'copper-plate':{ id: 'copper-plate',name: 'Copper Plate',type: 'item',  iconPath: '', hidden: false, subgroup: 'raw-material', order: 'b' },
    'water':       { id: 'water',       name: 'Water',       type: 'fluid', iconPath: '', hidden: false, subgroup: 'fluid',         order: 'a' },
    'iron-ore':    { id: 'iron-ore',    name: 'Iron Ore',    type: 'item',  iconPath: '', hidden: false, subgroup: 'raw-material', order: 'c' },
    'hidden-item': { id: 'hidden-item', name: 'Hidden',      type: 'item',  iconPath: '', hidden: true,  subgroup: 'raw-material', order: 'z' },
  },
  recipes: {
    'iron-plate': {
      id: 'iron-plate', name: 'Iron Plate', category: 'smelting', craftingTime: 3.2,
      ingredients: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
      products: [{ itemId: 'iron-plate', type: 'item', amount: 1 }],
      madeIn: ['stone-furnace'], allowProductivity: true, hidden: false,
      mainProduct: null, subgroup: 'smelting-basic', order: 'a',
    },
    'copper-plate': {
      id: 'copper-plate', name: 'Copper Plate', category: 'smelting', craftingTime: 3.2,
      ingredients: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
      products: [{ itemId: 'copper-plate', type: 'item', amount: 1 }],
      madeIn: ['stone-furnace'], allowProductivity: true, hidden: false,
      mainProduct: null, subgroup: 'smelting-basic', order: 'b',
    },
    'fill-water-barrel': {
      id: 'fill-water-barrel', name: 'Fill Water Barrel', category: 'crafting', craftingTime: 1,
      ingredients: [{ itemId: 'water', type: 'fluid', amount: 50 }],
      products: [{ itemId: 'iron-plate', type: 'item', amount: 1 }], // shares iron-plate as a product so all 3 show under the same item filter
      madeIn: ['assembling-machine-1'], allowProductivity: false, hidden: false,
      mainProduct: null, subgroup: 'fill-barrel', order: 'a',
    },
    'secret-recipe': {
      id: 'secret-recipe', name: 'Secret Recipe', category: 'smelting', craftingTime: 1,
      ingredients: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
      products: [{ itemId: 'iron-plate', type: 'item', amount: 1 }],
      madeIn: ['stone-furnace'], allowProductivity: false, hidden: true,
      mainProduct: null, subgroup: 'smelting-basic', order: 'z',
    },
  },
  machines: {
    'stone-furnace':       { id: 'stone-furnace',       name: 'Stone Furnace',       type: 'furnace',           craftingSpeed: 1, energyUsageKw: 90, energyType: 'burner',   drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: ['smelting'], iconPath: '', hidden: false },
    'assembling-machine-1':{ id: 'assembling-machine-1',name: 'Assembling Machine 1',type: 'assembling-machine',craftingSpeed: 0.5, energyUsageKw: 75, energyType: 'electric', drainKw: 5, moduleSlots: 0, allowedEffects: [], craftingCategories: ['crafting'], iconPath: '', hidden: false },
  },
  modules: {},
  beacons: {},
  defaultMachines: { smelting: 'stone-furnace', crafting: 'assembling-machine-1' },
  itemGroups: {
    'intermediates': { id: 'intermediates', name: 'Intermediates', order: 'a', iconPath: '' },
    'fluids':        { id: 'fluids',        name: 'Fluids',        order: 'b', iconPath: '' },
  },
  itemSubgroups: {
    'raw-material': { id: 'raw-material', group: 'intermediates', order: 'a' },
    'fluid':        { id: 'fluid',        group: 'fluids',        order: 'a' },
    'smelting-basic':{ id: 'smelting-basic', group: 'intermediates', order: 'b' },
    'fill-barrel':   { id: 'fill-barrel',    group: 'intermediates', order: 'c' },
  },
}

beforeEach(() => {
  useGameDataStore.setState({ status: { type: 'loaded', gameData: fixture } })
})

// ---------------------------------------------------------------------------
// Recipes mode
// ---------------------------------------------------------------------------

describe('ItemPicker — recipes mode', () => {
  it('groups recipes by subgroup into separate rows', () => {
    render(<ItemPicker source="recipes" filterByItemId="iron-plate" onSelect={() => {}} onClose={() => {}} />)
    const groups = screen.getAllByTestId('recipe-group')
    expect(groups).toHaveLength(2)
    expect(groups.map(g => g.getAttribute('data-subgroup'))).toEqual(
      expect.arrayContaining(['smelting-basic', 'fill-barrel']),
    )
  })

  it('hides hidden recipes by default and reveals them when toggled', () => {
    render(<ItemPicker source="recipes" filterByItemId="iron-plate" onSelect={() => {}} onClose={() => {}} />)

    const slotsBefore = screen.getAllByTestId('recipe-slot')
    expect(slotsBefore.find(s => s.getAttribute('data-recipe-id') === 'secret-recipe')).toBeUndefined()

    fireEvent.click(screen.getByLabelText(/Hidden recipes/, { selector: 'input' }))

    const slotsAfter = screen.getAllByTestId('recipe-slot')
    expect(slotsAfter.find(s => s.getAttribute('data-recipe-id') === 'secret-recipe')).toBeDefined()
  })

  it('search filter narrows results and shows empty state', () => {
    render(<ItemPicker source="recipes" onSelect={() => {}} onClose={() => {}} />)
    const search = screen.getByPlaceholderText('Search…')
    fireEvent.change(search, { target: { value: 'zzznomatch' } })
    expect(screen.getByText('No recipes match')).toBeInTheDocument()
  })

  it('clicking a slot calls onSelect and onClose', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<ItemPicker source="recipes" filterByItemId="iron-plate" onSelect={onSelect} onClose={onClose} />)
    const slot = screen.getAllByTestId('recipe-slot').find(s => s.getAttribute('data-recipe-id') === 'iron-plate')!
    fireEvent.click(slot)
    expect(onSelect).toHaveBeenCalledWith('iron-plate')
    expect(onClose).toHaveBeenCalled()
  })

  it('hovering a slot renders the recipe detail panel with sections and made-in list', () => {
    render(<ItemPicker source="recipes" filterByItemId="iron-plate" onSelect={() => {}} onClose={() => {}} />)
    const slot = screen.getAllByTestId('recipe-slot').find(s => s.getAttribute('data-recipe-id') === 'iron-plate')!
    fireEvent.mouseEnter(slot)

    const panel = screen.getByTestId('recipe-detail-panel')
    expect(panel).toHaveTextContent('Iron Plate')
    expect(panel).toHaveTextContent('(Recipe)')
    expect(panel).toHaveTextContent('Ingredients:')
    expect(panel).toHaveTextContent('Crafting time')
    expect(panel).toHaveTextContent('Products:')
    expect(panel).toHaveTextContent('Made in:')
    expect(panel).toHaveTextContent('Stone Furnace')
  })
})

// ---------------------------------------------------------------------------
// Items mode
// ---------------------------------------------------------------------------

describe('ItemPicker — items mode', () => {
  it('renders one tab per item group, sorted by group order', () => {
    render(<ItemPicker source="items" onSelect={() => {}} onClose={() => {}} />)
    const tabs = screen.getAllByTestId('item-group-tab')
    expect(tabs.map(t => t.getAttribute('data-group-id'))).toEqual(['intermediates', 'fluids'])
  })

  it('first non-empty group is selected by default', () => {
    render(<ItemPicker source="items" onSelect={() => {}} onClose={() => {}} />)
    const tabs = screen.getAllByTestId('item-group-tab')
    const intermediates = tabs.find(t => t.getAttribute('data-group-id') === 'intermediates')!
    expect(intermediates.getAttribute('data-active')).toBe('true')
  })

  it('clicking another tab swaps the visible items', () => {
    render(<ItemPicker source="items" onSelect={() => {}} onClose={() => {}} />)
    // Initially: items in 'intermediates' group (iron-plate, copper-plate, iron-ore)
    expect(screen.getAllByTestId('item-slot').map(s => s.getAttribute('data-item-id')))
      .toEqual(expect.arrayContaining(['iron-plate', 'copper-plate', 'iron-ore']))

    const fluidsTab = screen.getAllByTestId('item-group-tab').find(t => t.getAttribute('data-group-id') === 'fluids')!
    fireEvent.click(fluidsTab)

    const slots = screen.getAllByTestId('item-slot').map(s => s.getAttribute('data-item-id'))
    expect(slots).toContain('water')
    expect(slots).not.toContain('iron-plate')
  })

  it('clicking a slot calls onSelect with the current amount', () => {
    const onSelect = vi.fn()
    render(<ItemPicker source="items" onSelect={onSelect} onClose={() => {}} />)
    const amount = screen.getByLabelText('Amount')
    fireEvent.change(amount, { target: { value: '120' } })

    const slot = screen.getAllByTestId('item-slot').find(s => s.getAttribute('data-item-id') === 'iron-plate')!
    fireEvent.click(slot)
    expect(onSelect).toHaveBeenCalledWith('iron-plate', 120)
  })

  it('Cancel button closes without selecting', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<ItemPicker source="items" onSelect={onSelect} onClose={onClose} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('hidden items are excluded from the slot grid', () => {
    render(<ItemPicker source="items" onSelect={() => {}} onClose={() => {}} />)
    const ids = screen.getAllByTestId('item-slot').map(s => s.getAttribute('data-item-id'))
    expect(ids).not.toContain('hidden-item')
  })
})
