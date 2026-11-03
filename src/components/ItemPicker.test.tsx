import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { ItemPicker } from './ItemPicker'
import { useGameDataStore } from '../store/gameDataStore'
import { useBlockStore } from '../store/blockStore'
import type { GameData, Recipe } from '../data/types'

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

  it('disables the recipes already present where the new one would go', () => {
    const onSelect = vi.fn()
    render(
      <ItemPicker
        source="recipes"
        presentRecipes={{ ids: new Set(['iron-plate']), where: 'this area' }}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    )
    const slot = (id: string) => screen.getAllByTestId('recipe-slot').find(e => e.getAttribute('data-recipe-id') === id)!
    const present = slot('iron-plate')
    expect(present).toBeDisabled()
    expect(present).toHaveAttribute('data-in-area', 'true')
    expect(present).toHaveAttribute('title', 'Iron Plate (already in this area)')
    fireEvent.click(present)
    expect(onSelect).not.toHaveBeenCalled()
    expect(slot('copper-plate')).toBeEnabled()
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
    expect(screen.queryByLabelText(/Beyond research horizon/)).not.toBeInTheDocument()
  })

  it('offers every non-hidden recipe without targets', () => {
    loadWithTechnologies()
    render(<ItemPicker source="recipes" filterByItemId="iron-plate" onSelect={() => {}} onClose={() => {}} />)
    expect(slotIds()).toEqual(expect.arrayContaining(['iron-plate', 'fill-water-barrel']))
    expect(screen.queryByLabelText(/Beyond research horizon/)).not.toBeInTheDocument()
  })

  it('shows recipes beyond the horizon when the checkbox is ticked', () => {
    loadWithTechnologies()
    useBlockStore.setState({ horizonTechnologyIds: ['smelting'] })
    render(<ItemPicker source="recipes" onSelect={() => {}} onClose={() => {}} />)
    const checkbox = screen.getByLabelText(/Beyond research horizon/, { selector: 'input' })
    expect(checkbox).not.toBeChecked()
    expect(slotIds()).not.toContain('fill-water-barrel')
    fireEvent.click(checkbox)
    expect(slotIds()).toContain('fill-water-barrel')
    const slot = (id: string) => screen.getAllByTestId('recipe-slot').find(s => s.getAttribute('data-recipe-id') === id)!
    expect(slot('fill-water-barrel')).toHaveAttribute('data-beyond-horizon', 'true')
    expect(slot('iron-plate')).not.toHaveAttribute('data-beyond-horizon')
    fireEvent.click(checkbox)
    expect(slotIds()).not.toContain('fill-water-barrel')
  })

  it('does not mark hidden recipes as beyond the horizon', () => {
    loadWithTechnologies()
    useBlockStore.setState({ horizonTechnologyIds: ['smelting'] })
    render(<ItemPicker source="recipes" filterByItemId="iron-plate" onSelect={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText(/Hidden recipes/, { selector: 'input' }))
    const secret = screen.getAllByTestId('recipe-slot').find(s => s.getAttribute('data-recipe-id') === 'secret-recipe')!
    expect(secret).not.toHaveAttribute('data-beyond-horizon')
  })

  it('clears the empty-state horizon message when the checkbox is ticked', () => {
    loadWithTechnologies()
    useBlockStore.setState({ horizonTechnologyIds: ['smelting'] })
    render(<ItemPicker source="recipes" filterByItemId="water" onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText('No recipes match within the research horizon (1 outside it)')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Beyond research horizon/, { selector: 'input' }))
    expect(screen.getAllByTestId('recipe-slot').length).toBeGreaterThan(0)
    expect(screen.queryByText(/outside it/)).not.toBeInTheDocument()
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

/** The fixture plus the electricity item and one power recipe (a boiler burning coal). */
function fixtureWithPower(): GameData {
  const data = structuredClone(fixture)
  data.items['power:electricity'] = {
    id: 'power:electricity', name: 'Electricity', type: 'fluid', iconPath: '', hidden: false, subgroup: 'power:electricity', order: 'a',
  }
  data.items['power:heat'] = {
    id: 'power:heat', name: 'Heat', type: 'fluid', iconPath: '', hidden: false, subgroup: 'power:electricity', order: 'b',
  }
  data.items['coal'] = { id: 'coal', name: 'Coal', type: 'item', iconPath: '/icons/coal.png', hidden: false, subgroup: 'raw-material', order: 'd' }
  data.itemGroups['power:power'] = { id: 'power:power', name: 'Power', order: 'zz', iconPath: '' }
  data.itemSubgroups['power:electricity'] = { id: 'power:electricity', group: 'power:power', order: 'a' }
  data.itemSubgroups['power:boilers'] = { id: 'power:boilers', group: 'power:power', order: 'b' }
  data.machines['boiler'] = {
    id: 'boiler', name: 'Boiler', type: 'boiler', craftingSpeed: 1, energyUsageKw: 0, energyType: 'void', drainKw: 0,
    moduleSlots: 0, allowedEffects: [], craftingCategories: ['power:boiler'], iconPath: '/icons/boiler.png', hidden: false,
  }
  data.recipes['power:boiler:nuclear'] = {
    id: 'power:boiler:nuclear', name: 'Boiler (Coal)', category: 'power:boiler', craftingTime: 1,
    ingredients: [{ itemId: 'water', type: 'fluid', amount: 60 }, { itemId: 'coal', type: 'item', amount: 0.0015 }],
    products: [{ itemId: 'water', type: 'fluid', amount: 60 }],
    madeIn: ['boiler'], allowProductivity: false, hidden: false, mainProduct: 'water',
    subgroup: 'power:boilers', order: '', power: true,
  }
  return data
}

describe('ItemPicker — power generation', () => {
  beforeEach(() => {
    useGameDataStore.setState({ status: { type: 'loaded', gameData: fixtureWithPower(), sourceId: 'test' } })
  })

  it('takes the amount of electricity in MW and passes it per minute', () => {
    const onSelect = vi.fn()
    render(<ItemPicker source="items" onSelect={onSelect} onClose={() => {}} />)
    expect(screen.getByText('/min (MW for Electricity and Heat)')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10' } })
    fireEvent.click(screen.getAllByTestId('item-group-tab').find(t => t.getAttribute('data-group-id') === 'power:power')!)
    fireEvent.click(screen.getAllByTestId('item-slot').find(s => s.getAttribute('data-item-id') === 'power:electricity')!)
    expect(onSelect).toHaveBeenCalledWith('power:electricity', 600)
  })

  it('takes the amount of heat in MW too', () => {
    const onSelect = vi.fn()
    render(<ItemPicker source="items" onSelect={onSelect} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '21.6' } })
    fireEvent.click(screen.getAllByTestId('item-group-tab').find(t => t.getAttribute('data-group-id') === 'power:power')!)
    fireEvent.click(screen.getAllByTestId('item-slot').find(s => s.getAttribute('data-item-id') === 'power:heat')!)
    expect(onSelect).toHaveBeenCalledWith('power:heat', 1296)
  })

  it('shows a power recipe as its machine with the fuel as a badge, and small amounts with two digits', () => {
    render(<ItemPicker source="recipes" onSelect={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getAllByTestId('recipe-group-tab').find(t => t.getAttribute('data-group-id') === 'power:power')!)
    const slot = screen.getByTestId('recipe-slot')
    expect(slot.querySelector('img')).toHaveAttribute('alt', 'Boiler')
    expect(within(slot).getByTestId('recipe-slot-badge')).toHaveAttribute('src', expect.stringContaining('coal.png'))
    fireEvent.mouseEnter(slot)
    expect(screen.getByTestId('recipe-detail-panel')).toHaveTextContent('0.0015 ×')
  })
})

/** The power fixture with a three-fuel boiler, a two-fuel boiler-2, a one-recipe engine and a two-fuel reactor. */
function fixtureWithBoilerFuels(): GameData {
  const data = fixtureWithPower()
  delete data.recipes['power:boiler:nuclear']
  data.itemSubgroups['power:generators'] = { id: 'power:generators', group: 'power:power', order: 'c' }
  data.items['steam'] = { id: 'steam', name: 'Steam', type: 'fluid', iconPath: '/icons/steam.png', hidden: false, subgroup: 'fluid', order: 'b' }
  data.items['wood'] = { id: 'wood', name: 'Wood', type: 'item', iconPath: '/icons/wood.png', hidden: false, subgroup: 'raw-material', order: 'e' }
  data.items['solid-fuel'] = { id: 'solid-fuel', name: 'Solid fuel', type: 'item', iconPath: '/icons/solid-fuel.png', hidden: false, subgroup: 'raw-material', order: 'f' }
  data.items['uranium'] = { id: 'uranium', name: 'Uranium', type: 'item', iconPath: '/icons/uranium.png', hidden: false, subgroup: 'raw-material', order: 'g' }
  data.items['mox'] = { id: 'mox', name: 'MOX', type: 'item', iconPath: '/icons/mox.png', hidden: false, subgroup: 'raw-material', order: 'h' }
  for (const [id, name, icon] of [['boiler-2', 'Boiler 2', '/icons/boiler-2.png'], ['steam-engine', 'Steam engine', '/icons/engine.png'], ['reactor', 'Reactor', '/icons/reactor.png']]) {
    data.machines[id] = { ...data.machines['boiler'], id, name, iconPath: icon }
  }
  const power = (machine: string, label: string, fuel: string, fuelName: string, output: string, subgroup: string, input = 'water'): Recipe => ({
    id: `power:${machine}:${fuel}`, name: `${label} (${fuelName})`, category: `power:${machine}`, craftingTime: 1,
    ingredients: [{ itemId: input, type: input === 'water' ? 'fluid' : 'item', amount: 60 }, { itemId: fuel, type: 'item', amount: 0.01 }],
    products: [{ itemId: output, type: 'fluid', amount: 60 }],
    madeIn: [machine], allowProductivity: false, hidden: false, mainProduct: output, subgroup, order: fuel, power: true,
  })
  for (const r of [
    power('boiler', 'Boiler', 'coal', 'Coal', 'steam', 'power:boilers'),
    power('boiler', 'Boiler', 'wood', 'Wood', 'steam', 'power:boilers'),
    power('boiler', 'Boiler', 'solid-fuel', 'Solid fuel', 'steam', 'power:boilers'),
    power('boiler-2', 'Boiler 2', 'coal', 'Coal', 'steam', 'power:boilers'),
    power('boiler-2', 'Boiler 2', 'wood', 'Wood', 'steam', 'power:boilers'),
    power('reactor', 'Reactor', 'uranium', 'Uranium', 'power:heat', 'power:boilers'),
    power('reactor', 'Reactor', 'mox', 'MOX', 'power:heat', 'power:boilers'),
  ]) data.recipes[r.id] = r
  data.recipes['power:steam-engine:steam'] = {
    id: 'power:steam-engine:steam', name: 'Steam engine (Steam)', category: 'power:steam-engine', craftingTime: 1,
    ingredients: [{ itemId: 'steam', type: 'fluid', amount: 30 }],
    products: [{ itemId: 'power:electricity', type: 'fluid', amount: 900 }],
    madeIn: ['steam-engine'], allowProductivity: false, hidden: false, mainProduct: 'power:electricity',
    subgroup: 'power:generators', order: 'a', power: true,
  }
  return data
}

describe('ItemPicker — fuel groups', () => {
  const BOILER_IDS = ['power:boiler:coal', 'power:boiler:wood', 'power:boiler:solid-fuel']

  function renderPower(props: Partial<React.ComponentProps<typeof ItemPicker>> = {}, onSelect = vi.fn(), onClose = vi.fn()) {
    render(<ItemPicker source="recipes" onSelect={onSelect} onClose={onClose} {...props as object} />)
    fireEvent.click(screen.getAllByTestId('recipe-group-tab').find(t => t.getAttribute('data-group-id') === 'power:power')!)
    return { onSelect, onClose }
  }
  const groupSlot = (machineId: string) =>
    screen.queryAllByTestId('recipe-group-slot').find(s => s.getAttribute('data-machine-id') === machineId)
  const slotIds = () => screen.queryAllByTestId('recipe-slot').map(s => s.getAttribute('data-recipe-id'))
  const search = (q: string) => fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: q } })

  beforeEach(() => {
    useGameDataStore.setState({ status: { type: 'loaded', gameData: fixtureWithBoilerFuels(), sourceId: 'test' } })
  })

  it('shows one group slot per machine instead of one slot per fuel', () => {
    renderPower()
    const boiler = groupSlot('boiler')!
    expect(boiler).toHaveAttribute('data-recipe-count', '3')
    expect(within(boiler).getByTestId('recipe-group-count')).toHaveTextContent('3')
    expect(boiler.querySelector('img')).toHaveAttribute('alt', 'Boiler')
    expect(groupSlot('boiler-2')).toHaveAttribute('data-recipe-count', '2')
    expect(groupSlot('reactor')).toHaveAttribute('data-recipe-count', '2')
    expect(slotIds().filter(id => id?.startsWith('power:boiler:'))).toEqual([])
    expect(slotIds()).toContain('power:steam-engine:steam')
  })

  it('opens a fuel view with one fuel-icon slot per fuel and no badge', () => {
    const { onSelect } = renderPower()
    fireEvent.click(groupSlot('boiler')!)
    const grid = screen.getByTestId('recipe-fuel-grid')
    expect(within(grid).getAllByTestId('recipe-slot').map(s => s.getAttribute('data-recipe-id')).sort()).toEqual([...BOILER_IDS].sort())
    const wood = within(grid).getAllByTestId('recipe-slot').find(s => s.getAttribute('data-recipe-id') === 'power:boiler:wood')!
    expect(wood.querySelector('img')).toHaveAttribute('alt', 'Wood')
    expect(within(grid).queryByTestId('recipe-slot-badge')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recipe-group-slot')).not.toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('shows the detail panel on a fuel and selects it on click', () => {
    const { onSelect, onClose } = renderPower()
    fireEvent.click(groupSlot('boiler')!)
    const wood = screen.getAllByTestId('recipe-slot').find(s => s.getAttribute('data-recipe-id') === 'power:boiler:wood')!
    fireEvent.mouseEnter(wood)
    expect(screen.getByTestId('recipe-detail-panel')).toBeInTheDocument()
    fireEvent.click(wood)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('power:boiler:wood')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('goes back to the groups and clears the detail panel', () => {
    renderPower()
    fireEvent.click(groupSlot('boiler')!)
    fireEvent.mouseEnter(screen.getAllByTestId('recipe-slot')[0])
    expect(screen.getByTestId('recipe-detail-panel')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('recipe-fuel-back'))
    expect(screen.queryByTestId('recipe-detail-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recipe-fuel-grid')).not.toBeInTheDocument()
    expect(groupSlot('boiler')).toBeDefined()
  })

  it('opening a group clears a stale hover', () => {
    renderPower()
    fireEvent.mouseEnter(screen.getByTestId('recipe-slot'))
    expect(screen.getByTestId('recipe-detail-panel')).toBeInTheDocument()
    fireEvent.click(groupSlot('boiler')!)
    expect(screen.queryByTestId('recipe-detail-panel')).not.toBeInTheDocument()
  })

  it('searches per-fuel recipe names: one match is a plain slot, a machine name still groups', () => {
    renderPower()
    search('Wood')
    expect(slotIds().sort()).toEqual(['power:boiler-2:wood', 'power:boiler:wood'])
    expect(screen.queryByTestId('recipe-group-slot')).not.toBeInTheDocument()
    search('Boiler (Wood)')
    expect(slotIds()).toEqual(['power:boiler:wood'])
    expect(screen.queryByTestId('recipe-group-slot')).not.toBeInTheDocument()
    search('Boiler 2')
    expect(groupSlot('boiler-2')).toHaveAttribute('data-recipe-count', '2')
  })

  it('falls back to the plain list when a search leaves one fuel, and does not reopen on clearing it', () => {
    renderPower()
    fireEvent.click(groupSlot('boiler')!)
    search('Boiler (Wood)')
    expect(screen.queryByTestId('recipe-fuel-grid')).not.toBeInTheDocument()
    expect(slotIds()).toEqual(['power:boiler:wood'])
    search('')
    expect(screen.queryByTestId('recipe-fuel-grid')).not.toBeInTheDocument()
    expect(groupSlot('boiler')).toBeDefined()
  })

  it('groups after the item filter', () => {
    render(<ItemPicker source="recipes" filterByItemId="steam" onSelect={() => {}} onClose={() => {}} />)
    expect(groupSlot('boiler')).toHaveAttribute('data-recipe-count', '3')
    expect(groupSlot('boiler-2')).toHaveAttribute('data-recipe-count', '2')
    expect(slotIds()).toEqual([])
  })

  it('keeps a single remaining recipe plain under a consumer filter', () => {
    render(<ItemPicker source="recipes" consumesItemId="steam" onSelect={() => {}} onClose={() => {}} />)
    expect(slotIds()).toEqual(['power:steam-engine:steam'])
    expect(screen.queryByTestId('recipe-group-slot')).not.toBeInTheDocument()
  })

  it('disables a group only when every fuel is already in the area', () => {
    renderPower({ presentRecipes: { ids: new Set(BOILER_IDS), where: 'this area' } })
    expect(groupSlot('boiler')).toBeDisabled()
    expect(groupSlot('boiler')).toHaveAttribute('data-in-area', 'true')
    expect(groupSlot('boiler-2')).toBeEnabled()
  })

  it('opens a partly present group and disables only the fuel already there', () => {
    renderPower({ presentRecipes: { ids: new Set(['power:boiler:coal']), where: 'this area' } })
    expect(groupSlot('boiler')).toBeEnabled()
    fireEvent.click(groupSlot('boiler')!)
    const slots = screen.getAllByTestId('recipe-slot')
    expect(slots.find(s => s.getAttribute('data-recipe-id') === 'power:boiler:coal')).toBeDisabled()
    expect(slots.find(s => s.getAttribute('data-recipe-id') === 'power:boiler:wood')).toBeEnabled()
  })

  it('closes the fuel view when the tab changes', () => {
    renderPower()
    fireEvent.click(groupSlot('boiler')!)
    const tabs = screen.getAllByTestId('recipe-group-tab')
    fireEvent.click(tabs.find(t => t.getAttribute('data-group-id') !== 'power:power')!)
    fireEvent.click(tabs.find(t => t.getAttribute('data-group-id') === 'power:power')!)
    expect(screen.queryByTestId('recipe-fuel-grid')).not.toBeInTheDocument()
    expect(groupSlot('boiler')).toBeDefined()
  })

  it('groups reactor fuels the same way', () => {
    renderPower()
    fireEvent.click(groupSlot('reactor')!)
    expect(screen.getAllByTestId('recipe-slot').map(s => s.getAttribute('data-recipe-id')).sort())
      .toEqual(['power:reactor:mox', 'power:reactor:uranium'])
  })
})

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

  it('clicking a slot with the amount cleared selects it without extra output', () => {
    const onSelect = vi.fn()
    render(<ItemPicker source="items" onSelect={onSelect} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '' } })
    const slot = screen.getAllByTestId('item-slot').find(s => s.getAttribute('data-item-id') === 'iron-plate')!
    fireEvent.click(slot)
    expect(onSelect).toHaveBeenCalledWith('iron-plate', undefined)
  })

  it.each(['0', '-3'])('does not select with an amount of %s and disables Submit', value => {
    const onSelect = vi.fn()
    render(<ItemPicker source="items" onSelect={onSelect} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value } })
    const slot = screen.getAllByTestId('item-slot').find(s => s.getAttribute('data-item-id') === 'iron-plate')!
    fireEvent.click(slot)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
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

// ---------------------------------------------------------------------------
// Recipe detail panel — fluid temperatures
// ---------------------------------------------------------------------------

describe('ItemPicker — recipe detail panel temperatures', () => {
  function hoverWith(recipe: GameData['recipes'][string]) {
    const data = structuredClone(fixture)
    data.recipes[recipe.id] = recipe
    useGameDataStore.setState({ status: { type: 'loaded', gameData: data, sourceId: 'test' } })
    render(<ItemPicker source="recipes" onSelect={() => {}} onClose={() => {}} />)
    const slot = screen.getAllByTestId('recipe-slot').find(s => s.getAttribute('data-recipe-id') === recipe.id)!
    fireEvent.mouseEnter(slot)
    return screen.getByTestId('recipe-detail-panel')
  }

  const base = {
    category: 'crafting', craftingTime: 1, madeIn: ['assembling-machine-1'], allowProductivity: false, hidden: false,
    mainProduct: null, subgroup: 'smelting-basic', order: 'q',
  }

  it('shows the ingredient bound and the explicit product temperature', () => {
    const panel = hoverWith({
      ...base, id: 'steam-recipe', name: 'Steam Recipe',
      ingredients: [{ itemId: 'water', type: 'fluid', amount: 10, minimumTemperature: 95 }],
      products: [{ itemId: 'steam', type: 'fluid', amount: 10, temperature: 165 }],
    } as unknown as GameData['recipes'][string])
    expect(within(panel).getAllByTestId('recipe-detail-temperature').map(e => e.textContent)).toEqual(['≥95°C', '165°C'])
  })

  it('shows none when the recipe states no temperature', () => {
    const panel = hoverWith({
      ...base, id: 'plain-recipe', name: 'Plain Recipe',
      ingredients: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
      products: [{ itemId: 'iron-plate', type: 'item', amount: 1 }],
    } as unknown as GameData['recipes'][string])
    expect(within(panel).queryByTestId('recipe-detail-temperature')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Recipe detail panel — "Unlocked by:" section
// ---------------------------------------------------------------------------

describe('ItemPicker — recipe detail panel unlock section', () => {
  const packs1 = { ingredients: [{ itemId: 'iron-ore', amount: 1 }], count: 10, time: 5 }

  function hover(data: GameData, recipeId: string) {
    useGameDataStore.setState({ status: { type: 'loaded', gameData: data, sourceId: 'test' } })
    render(<ItemPicker source="recipes" onSelect={() => {}} onClose={() => {}} />)
    const slot = screen.getAllByTestId('recipe-slot').find(s => s.getAttribute('data-recipe-id') === recipeId)!
    fireEvent.mouseEnter(slot)
    return screen.getByTestId('recipe-detail-panel')
  }

  it('is absent without technology data', () => {
    hover(fixture, 'iron-plate')
    expect(screen.getByTestId('recipe-detail-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('recipe-unlock')).toBeNull()
  })

  it('shows one costed technology without the research time', () => {
    const data = fixtureWithTechnologies()
    data.technologies.smelting.cost = structuredClone(packs1)
    hover(data, 'iron-plate')
    const unlock = screen.getByTestId('recipe-unlock')
    expect(unlock.dataset.unlockKind).toBe('technologies')
    expect(unlock).toHaveTextContent('Unlocked by:')
    const rows = screen.getAllByTestId('recipe-unlock-tech')
    expect(rows).toHaveLength(1)
    expect(rows[0].dataset.techId).toBe('smelting')
    expect(rows[0]).toHaveTextContent('Smelting')
    expect(within(rows[0]).getByTitle('Iron Ore ×1')).toBeInTheDocument()
    const cost = within(rows[0]).getByTestId('tech-cost')
    expect(cost).toHaveTextContent('×10')
    expect(cost.textContent).not.toContain('·')
    expect(cost.textContent).not.toContain('5s')
  })

  it('reads "Available from the start" for a starting recipe', () => {
    hover(fixtureWithTechnologies(), 'copper-plate')
    const unlock = screen.getByTestId('recipe-unlock')
    expect(unlock.dataset.unlockKind).toBe('start')
    expect(unlock).toHaveTextContent('Available from the start')
    expect(screen.queryByTestId('recipe-unlock-tech')).toBeNull()
  })

  it('lists several technologies, fewest pack types first, with a formula count', () => {
    const data = fixtureWithTechnologies()
    data.technologies.smelting.cost = structuredClone(packs1)
    data.technologies.extra = {
      id: 'extra', name: 'Extra', prerequisites: [], unlockedRecipes: ['iron-plate'], iconPath: '',
      cost: { ingredients: [{ itemId: 'iron-ore', amount: 1 }, { itemId: 'water', amount: 1 }], count: null, time: 1 },
    }
    hover(data, 'iron-plate')
    const rows = screen.getAllByTestId('recipe-unlock-tech')
    expect(rows.map(r => r.dataset.techId)).toEqual(['smelting', 'extra'])
    const cost = within(rows[1]).getByTestId('tech-cost')
    expect(cost).toHaveTextContent('×?')
    expect(cost.textContent).not.toContain('·')
  })

  it('shows Trigger for a research-trigger technology', () => {
    const data = fixtureWithTechnologies()
    data.technologies.smelting.cost = null
    hover(data, 'iron-plate')
    expect(screen.getByTestId('tech-cost').textContent).toBe('Trigger')
  })

  it('reads "No technology" for a recipe nothing unlocks', () => {
    useGameDataStore.setState({ status: { type: 'loaded', gameData: fixtureWithTechnologies(), sourceId: 'test' } })
    render(<ItemPicker source="recipes" onSelect={() => {}} onClose={() => {}} />)
    fireEvent.click(screen.getByLabelText(/Hidden recipes/, { selector: 'input' }))
    const slot = screen.getAllByTestId('recipe-slot').find(s => s.getAttribute('data-recipe-id') === 'secret-recipe')!
    fireEvent.mouseEnter(slot)
    const unlock = screen.getByTestId('recipe-unlock')
    expect(unlock.dataset.unlockKind).toBe('none')
    expect(unlock).toHaveTextContent('No technology unlocks this recipe')
  })

  it('draws the top border only when the recipe has machines', () => {
    const withMachines = fixtureWithTechnologies()
    hover(withMachines, 'iron-plate')
    expect(screen.getByTestId('recipe-unlock')).toHaveClass('border-t')
    cleanup()

    const noMachines = fixtureWithTechnologies()
    noMachines.recipes['iron-plate'].madeIn = []
    hover(noMachines, 'iron-plate')
    expect(screen.getByTestId('recipe-unlock')).not.toHaveClass('border-t')
  })
})
