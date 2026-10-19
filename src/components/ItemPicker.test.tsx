import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ItemPicker } from './ItemPicker'
import { useGameDataStore } from '../store/gameDataStore'
import { useBlockStore } from '../store/blockStore'
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
    // Lives in subgroup 'fluid' → group 'fluids', so the unfiltered recipe
    // picker renders both 'intermediates' and 'fluids' tabs.
    'boil-water': {
      id: 'boil-water', name: 'Boil Water', category: 'crafting', craftingTime: 1,
      ingredients: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
      products: [{ itemId: 'water', type: 'fluid', amount: 100 }],
      madeIn: ['assembling-machine-1'], allowProductivity: false, hidden: false,
      mainProduct: null, subgroup: 'fluid', order: 'a',
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
  technologies: {},
  startingRecipes: [],
}

/** A fresh copy of the fixture with a research tree: copper-plate is a starting recipe, `smelting` unlocks iron-plate. */
function fixtureWithTechnologies(): GameData {
  const data = structuredClone(fixture)
  data.technologies = {
    'smelting': { id: 'smelting', name: 'Smelting', prerequisites: [], unlockedRecipes: ['iron-plate'], iconPath: '' },
    'barrels':  { id: 'barrels',  name: 'Barrels',  prerequisites: ['smelting'], unlockedRecipes: ['fill-water-barrel'], iconPath: '' },
    'boiling':  { id: 'boiling',  name: 'Boiling',  prerequisites: [], unlockedRecipes: ['boil-water'], iconPath: '' },
  }
  data.startingRecipes = ['copper-plate']
  return data
}

beforeEach(() => {
  useGameDataStore.setState({ status: { type: 'loaded', gameData: fixture, sourceId: 'test' } })
  useBlockStore.setState({ horizonTechnologyIds: [] })
})

// ---------------------------------------------------------------------------
// Recipes mode
// ---------------------------------------------------------------------------

describe('ItemPicker — recipes mode', () => {
  it('renders one tab per item-group present in the results, sorted by group order', () => {
    render(<ItemPicker source="recipes" onSelect={() => {}} onClose={() => {}} />)
    const tabs = screen.getAllByTestId('recipe-group-tab')
    expect(tabs.map(t => t.getAttribute('data-group-id'))).toEqual(['intermediates', 'fluids'])
  })

  it('default-selects the first visible group and shows only its subgroup rows', () => {
    render(<ItemPicker source="recipes" onSelect={() => {}} onClose={() => {}} />)
    const intermediates = screen.getAllByTestId('recipe-group-tab').find(t => t.getAttribute('data-group-id') === 'intermediates')!
    expect(intermediates.getAttribute('data-active')).toBe('true')

    const subgroupIds = screen.getAllByTestId('recipe-subgroup-row')
      .map(r => r.getAttribute('data-subgroup'))
    expect(subgroupIds).toEqual(expect.arrayContaining(['smelting-basic', 'fill-barrel']))
    expect(subgroupIds).not.toContain('fluid') // fluid lives in the 'fluids' group
  })

  it('clicking a different tab swaps the visible subgroup rows', () => {
    render(<ItemPicker source="recipes" onSelect={() => {}} onClose={() => {}} />)
    const fluidsTab = screen.getAllByTestId('recipe-group-tab').find(t => t.getAttribute('data-group-id') === 'fluids')!
    fireEvent.click(fluidsTab)

    const subgroupIds = screen.getAllByTestId('recipe-subgroup-row')
      .map(r => r.getAttribute('data-subgroup'))
    expect(subgroupIds).toEqual(['fluid'])
  })

  it('groups recipes by subgroup within the selected tab', () => {
    render(<ItemPicker source="recipes" filterByItemId="iron-plate" onSelect={() => {}} onClose={() => {}} />)
    const rows = screen.getAllByTestId('recipe-subgroup-row')
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.getAttribute('data-subgroup'))).toEqual(
      expect.arrayContaining(['smelting-basic', 'fill-barrel']),
    )
  })

  it('hides the tab strip when filterByItemId leaves only one group', () => {
    // All iron-plate-producing recipes live in the 'intermediates' group.
    render(<ItemPicker source="recipes" filterByItemId="iron-plate" onSelect={() => {}} onClose={() => {}} />)
    expect(screen.queryAllByTestId('recipe-group-tab')).toHaveLength(0)
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

  it('consumesItemId lists only recipes taking that item as an ingredient, hidden ones on demand', () => {
    render(<ItemPicker source="recipes" consumesItemId="iron-ore" onSelect={() => {}} onClose={() => {}} />)
    const ids = () => screen.queryAllByTestId('recipe-slot').map(s => s.getAttribute('data-recipe-id'))
    // The unfiltered picker shows one group tab at a time; boil-water lives in 'fluids'.
    fireEvent.click(screen.getAllByTestId('recipe-group-tab').find(t => t.getAttribute('data-group-id') === 'fluids')!)
    expect(ids()).toEqual(['boil-water'])
    fireEvent.click(screen.getAllByTestId('recipe-group-tab').find(t => t.getAttribute('data-group-id') === 'intermediates')!)
    expect(ids()).toEqual(expect.arrayContaining(['iron-plate', 'copper-plate']))
    expect(ids()).not.toContain('fill-water-barrel')
    expect(ids()).not.toContain('secret-recipe')

    fireEvent.click(screen.getByLabelText(/Hidden recipes/, { selector: 'input' }))
    expect(ids()).toContain('secret-recipe')
  })

  it('consumesItemId shows a consumer subtitle and hides the tab strip when one group remains', () => {
    render(<ItemPicker source="recipes" consumesItemId="water" onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText("Choose a recipe that consumes 'Water'")).toBeInTheDocument()
    expect(screen.getAllByTestId('recipe-slot').map(s => s.getAttribute('data-recipe-id'))).toEqual(['fill-water-barrel'])
    expect(screen.queryAllByTestId('recipe-group-tab')).toHaveLength(0)
  })

  it('consumesItemId and filterByItemId intersect', () => {
    render(<ItemPicker source="recipes" filterByItemId="iron-plate" consumesItemId="iron-ore" onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getAllByTestId('recipe-slot').map(s => s.getAttribute('data-recipe-id'))).toEqual(['iron-plate'])
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
// Recipes mode — research horizon
// ---------------------------------------------------------------------------

describe('ItemPicker — recipes mode with a research horizon', () => {
  function loadWithTechnologies() {
    useGameDataStore.setState({ status: { type: 'loaded', gameData: fixtureWithTechnologies(), sourceId: 'test' } })
  }

  function slotIds() {
    return screen.getAllByTestId('recipe-slot').map(s => s.getAttribute('data-recipe-id'))
  }

  it('leaves out recipes outside the horizon and keeps those inside', () => {
    loadWithTechnologies()
    useBlockStore.setState({ horizonTechnologyIds: ['smelting'] })
    render(<ItemPicker source="recipes" filterByItemId="iron-plate" onSelect={() => {}} onClose={() => {}} />)
    expect(slotIds()).toEqual(['iron-plate'])
  })

  it('includes recipes unlocked by prerequisites and starting recipes', () => {
    loadWithTechnologies()
    useBlockStore.setState({ horizonTechnologyIds: ['barrels'] })
    render(<ItemPicker source="recipes" onSelect={() => {}} onClose={() => {}} />)
    expect(slotIds()).toEqual(expect.arrayContaining(['iron-plate', 'copper-plate', 'fill-water-barrel']))
    expect(slotIds()).not.toContain('boil-water')
  })

  it('exempts hidden recipes from the horizon', () => {
    loadWithTechnologies()
    useBlockStore.setState({ horizonTechnologyIds: ['smelting'] })
    render(<ItemPicker source="recipes" filterByItemId="iron-plate" onSelect={() => {}} onClose={() => {}} />)
    expect(slotIds()).not.toContain('secret-recipe')
    fireEvent.click(screen.getByLabelText(/Hidden recipes/, { selector: 'input' }))
    expect(slotIds()).toContain('secret-recipe')
  })

  it('offers every non-hidden recipe without technology data', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['smelting'] })
    render(<ItemPicker source="recipes" filterByItemId="iron-plate" onSelect={() => {}} onClose={() => {}} />)
    expect(slotIds()).toEqual(expect.arrayContaining(['iron-plate', 'fill-water-barrel']))
    expect(slotIds()).not.toContain('secret-recipe')
  })

  it('offers every non-hidden recipe without targets', () => {
    loadWithTechnologies()
    render(<ItemPicker source="recipes" filterByItemId="iron-plate" onSelect={() => {}} onClose={() => {}} />)
    expect(slotIds()).toEqual(expect.arrayContaining(['iron-plate', 'fill-water-barrel']))
  })

  it('explains an empty result caused by the horizon', () => {
    loadWithTechnologies()
    useBlockStore.setState({ horizonTechnologyIds: ['smelting'] })
    render(<ItemPicker source="recipes" filterByItemId="water" onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText('No recipes match within the research horizon (1 outside it)')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Items mode — research horizon
// ---------------------------------------------------------------------------

describe('ItemPicker — items mode with a research horizon', () => {
  function loadWithTechnologies() {
    useGameDataStore.setState({ status: { type: 'loaded', gameData: fixtureWithTechnologies(), sourceId: 'test' } })
  }

  function slotIds() {
    return screen.getAllByTestId('item-slot').map(s => s.getAttribute('data-item-id'))
  }

  function openFluidsTab() {
    fireEvent.click(screen.getAllByTestId('item-group-tab').find(t => t.getAttribute('data-group-id') === 'fluids')!)
  }

  it('offers raw items and in-horizon products but not items produced only outside it', () => {
    loadWithTechnologies()
    useBlockStore.setState({ horizonTechnologyIds: ['smelting'] })
    render(<ItemPicker source="items" onSelect={() => {}} onClose={() => {}} />)
    expect(slotIds()).toEqual(expect.arrayContaining(['iron-plate', 'copper-plate', 'iron-ore']))
    expect(slotIds()).not.toContain('water')
    const tabs = screen.getAllByTestId('item-group-tab')
    expect(tabs.map(t => t.getAttribute('data-group-id'))).toEqual(['intermediates'])
  })

  it('offers water once its producing recipe is inside the horizon', () => {
    loadWithTechnologies()
    useBlockStore.setState({ horizonTechnologyIds: ['boiling'] })
    render(<ItemPicker source="items" onSelect={() => {}} onClose={() => {}} />)
    openFluidsTab()
    expect(slotIds()).toContain('water')
  })

  it('offers every non-hidden item without targets', () => {
    loadWithTechnologies()
    render(<ItemPicker source="items" onSelect={() => {}} onClose={() => {}} />)
    openFluidsTab()
    expect(slotIds()).toContain('water')
  })

  it('offers every non-hidden item without technology data', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['smelting'] })
    render(<ItemPicker source="items" onSelect={() => {}} onClose={() => {}} />)
    openFluidsTab()
    expect(slotIds()).toContain('water')
  })

  it('explains an empty result caused by the horizon', () => {
    loadWithTechnologies()
    useBlockStore.setState({ horizonTechnologyIds: ['smelting'] })
    render(<ItemPicker source="items" initialQuery="water" onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText('No items match within the research horizon (1 outside it)')).toBeInTheDocument()
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
