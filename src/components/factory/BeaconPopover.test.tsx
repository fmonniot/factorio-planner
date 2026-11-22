import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BeaconCell } from './BeaconPopover'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import type { GameData, BeaconConfig, RecipeNode } from '../../data/types'

const speedModule = {
  id: 'speed-3',
  name: 'Speed 3',
  iconPath: '',
  category: 'speed',
  effects: { speed: 0.5, consumption: 0.7 },
  limitation: [],
  limitationBlacklist: [],
  tier: 3,
}

const mockGameData: GameData = {
  factorioVersion: '2.0.0',
  modSet: {},
  items: {},
  recipes: {
    'iron-plate': {
      id: 'iron-plate',
      name: 'Iron Plate',
      hidden: false,
      category: 'crafting',
      craftingTime: 1,
      ingredients: [],
      products: [{ itemId: 'iron-plate', type: 'item', amount: 1 }],
      madeIn: [],
      allowProductivity: false,
      mainProduct: undefined,
      subgroup: '',
      order: '',
    },
  },
  machines: {},
  modules: { 'speed-3': speedModule },
  beacons: {},
  defaultMachines: {},
  itemGroups: {},
  itemSubgroups: {},
  technologies: {},
  startingRecipes: [],
}

const beacon: BeaconConfig = {
  modules: [{ moduleId: 'speed-3', count: 2 }],
  beaconCount: 4,
  modulesPerBeacon: 2,
  distributionEfficiency: 0.5,
}

const node: RecipeNode = {
  kind: 'game-recipe',
  id: 'n1',
  recipeId: 'iron-plate',
  modules: [],
  byproductPolicy: {},
  beaconConfigs: [beacon],
}

beforeEach(() => {
  const block = makeEmptyBlock('Test')
  const rootPlan = { ...block.rootPlan, nodes: [node] }
  useBlockStore.setState({
    blocks: [{ ...block, rootPlan }],
    activeBlockId: block.id,
    history: {},
    horizonTechnologyIds: [],
  })
})

// ---------------------------------------------------------------------------
// Research horizon
// ---------------------------------------------------------------------------

function horizonData(): GameData {
  const placer = (id: string, placeResult?: string) =>
    ({ id, name: id, type: 'item' as const, iconPath: '', hidden: false, subgroup: '', order: '', placeResult })
  const maker = (id: string, itemId: string) => ({ ...mockGameData.recipes['iron-plate'], id, name: id, products: [{ itemId, type: 'item' as const, amount: 1 }] })
  return {
    ...structuredClone(mockGameData),
    items: {
      'am1': placer('am1', 'am1'),
      'beacon-item': placer('beacon-item', 'beacon'),
      'speed-3': placer('speed-3'),
    },
    recipes: {
      ...structuredClone(mockGameData.recipes),
      'r-am1': maker('r-am1', 'am1'),
      'r-beacon': maker('r-beacon', 'beacon-item'),
      'r-speed': maker('r-speed', 'speed-3'),
    },
    machines: {
      am1: {
        id: 'am1', name: 'Am1', type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 1, energyType: 'electric',
        drainKw: 0, moduleSlots: 2, allowedEffects: ['speed'], craftingCategories: ['crafting'], iconPath: '', hidden: false,
      },
    },
    beacons: {
      beacon: { id: 'beacon', name: 'Beacon', iconPath: '', hidden: false, moduleSlots: 2, distributionEfficiency: 1.5, allowedEffects: ['speed', 'consumption'] },
    },
    defaultMachines: { crafting: 'am1' },
    technologies: {
      base: { id: 'base', name: 'Base', prerequisites: [], unlockedRecipes: ['iron-plate', 'r-am1'], iconPath: '' },
      mods: { id: 'mods', name: 'Mods', prerequisites: [], unlockedRecipes: ['r-beacon', 'r-speed'], iconPath: '' },
    },
  }
}

describe('BeaconCell — module categories', () => {
  function categoryData(): GameData {
    const gd = horizonData()
    gd.modules = {
      'speed-3': speedModule,
      agri: { ...speedModule, id: 'agri', name: 'Agriculture module', category: 'angels-bio-yield', effects: { speed: 0.1 } },
    }
    gd.beacons.beacon.allowedModuleCategories = ['speed']
    return gd
  }
  const props = { nodeId: 'n1', recipeId: 'iron-plate', machineId: undefined, recipeCategory: 'crafting', onOpenEdit: () => {} }

  it('flags the module chip holding a module the beacon rejects by category', () => {
    const list = [{ ...beacon, beaconId: 'beacon', modules: [{ moduleId: 'agri', count: 1 }] }]
    render(<BeaconCell {...props} gameData={categoryData()} beacons={list} />)
    expect(screen.getByTestId('beacon-module-chip')).toHaveAttribute('data-incompatible', 'true')
  })

  it('does not flag an accepted module', () => {
    render(<BeaconCell {...props} gameData={categoryData()} beacons={[{ ...beacon, beaconId: 'beacon' }]} />)
    expect(screen.getByTestId('beacon-module-chip')).not.toHaveAttribute('data-incompatible')
  })

  it('leaves the module out of the fill picker', () => {
    render(<BeaconCell {...props} gameData={categoryData()} beacons={[{ ...beacon, beaconId: 'beacon', modules: [] }]} />)
    fireEvent.click(screen.getByTestId('beacon-module-chip'))
    expect(screen.getAllByTestId('module-fill-option').map(o => o.getAttribute('data-module-id'))).toEqual(['speed-3'])
  })
})

describe('BeaconCell — creating a beacon', () => {
  function restrictedData(): GameData {
    const gd = horizonData()
    gd.modules = {
      'speed-3': speedModule,
      'prod-3': { ...speedModule, id: 'prod-3', name: 'Prod 3', category: 'productivity', effects: { productivity: 0.1, speed: -0.15 } },
    }
    gd.recipes['iron-plate'].allowProductivity = true
    return gd
  }

  it('creates the beacon with the chosen module', () => {
    useBlockStore.setState({ horizonTechnologyIds: [] })
    const gd = restrictedData()
    // 'Prod 3' sorts before 'Speed 3', so without the check it would be the default.
    render(
      <BeaconCell nodeId="n1" beacons={[]} gameData={gd} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" onOpenEdit={() => {}} />,
    )
    fireEvent.click(screen.getByLabelText('Add beacon'))
    // The picker offers only what the beacon accepts: no productivity module.
    expect(screen.getAllByTestId('module-fill-option').map(o => o.getAttribute('data-module-id'))).toEqual(['speed-3'])
    fireEvent.click(screen.getByText('Speed 3'))
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(updated.kind === 'game-recipe' && updated.beaconConfigs?.[0]?.modules).toEqual([{ moduleId: 'speed-3', count: 2 }])
  })
})

describe('BeaconCell — filling a beacon without slots', () => {
  it('stores no module when the beacon type has no slot, since a count of 0 is not a valid plan', () => {
    useBlockStore.setState({ horizonTechnologyIds: [] })
    const gd = horizonData()
    gd.beacons.beacon.moduleSlots = 0
    const empty: BeaconConfig = { beaconId: 'beacon', modules: [], beaconCount: 4, modulesPerBeacon: 0, distributionEfficiency: 1.5 }
    render(
      <BeaconCell nodeId="n1" beacons={[empty]} gameData={gd} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" onOpenEdit={() => {}} />,
    )
    fireEvent.click(screen.getByTestId('beacon-module-chip'))
    fireEvent.click(screen.getByTestId('module-fill-option'))
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(updated.kind === 'game-recipe' && updated.beaconConfigs?.[0]?.modules).toEqual([])
  })
})

describe('BeaconCell — research horizon', () => {
  function renderCell(gameData: GameData) {
    return render(
      <BeaconCell nodeId="n1" beacons={[]} gameData={gameData} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" onOpenEdit={() => {}} />,
    )
  }

  it('is disabled when no machine is within the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    const gd = horizonData()
    gd.technologies.base.unlockedRecipes = ['iron-plate']
    gd.technologies.mods.unlockedRecipes = ['r-am1', 'r-beacon', 'r-speed']
    renderCell(gd)
    const btn = screen.getByLabelText('Add beacon')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', 'No machine within research horizon')
    // Not a quiet placeholder: gray-700 at 40% opacity would vanish, and it must not brighten on hover.
    expect(btn.querySelector('.border-dashed')).toHaveClass('border-gray-600')
    expect(btn.className).toContain('opacity-40')
    expect(btn.querySelector('.border-dashed')!.className).not.toContain('border-gray-700')
  })

  it('is disabled when no beacon is within the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    renderCell(horizonData())
    const btn = screen.getByLabelText('Add beacon')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', 'No beacon within the research horizon')
  })

  it('is disabled when no module is within the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    const gd = horizonData()
    gd.technologies.base.unlockedRecipes = ['iron-plate', 'r-am1', 'r-beacon']
    gd.technologies.mods.unlockedRecipes = ['r-speed']
    renderCell(gd)
    expect(screen.getByLabelText('Add beacon')).toHaveAttribute('title', 'No module within the research horizon')
  })

  it('creates the beacon config without a horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: [] })
    renderCell(horizonData())
    fireEvent.click(screen.getByLabelText('Add beacon'))
    fireEvent.click(screen.getByTestId('module-fill-option'))
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(updated.kind === 'game-recipe' && updated.beaconConfigs?.[0]?.beaconId).toBe('beacon')
  })

  it('does not blame a horizon when the data has no modules and no horizon is set', () => {
    useBlockStore.setState({ horizonTechnologyIds: [] })
    const gd = horizonData()
    gd.modules = {}
    renderCell(gd)
    const btn = screen.getByLabelText('Add beacon')
    expect(btn).not.toBeDisabled()
    expect(btn).toHaveAttribute('title', 'Add beacon')
  })
})

describe('BeaconCell — beyond the horizon over several configurations', () => {
  it('rings the chip when a later configuration is beyond the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    const gd = horizonData()
    gd.technologies.base.unlockedRecipes = ['iron-plate', 'r-am1', 'r-beacon']
    gd.technologies.mods.unlockedRecipes = ['r-speed']
    const inside: BeaconConfig = { beaconId: 'beacon', modules: [], beaconCount: 4, modulesPerBeacon: 2, distributionEfficiency: 1.5 }
    const outside: BeaconConfig = { ...inside, modules: [{ moduleId: 'speed-3', count: 2 }] }
    const renderWith = (beacons: BeaconConfig[]) =>
      render(
        <BeaconCell nodeId="n1" beacons={beacons} gameData={gd} recipeId="iron-plate"
          machineId={undefined} recipeCategory="crafting" onOpenEdit={() => {}} />,
      )
    const { unmount } = renderWith([inside])
    expect(screen.getByLabelText('Edit beacon')).not.toHaveAttribute('data-beyond-horizon')
    unmount()
    renderWith([inside, outside])
    expect(screen.getByLabelText('Edit beacon')).toHaveAttribute('data-beyond-horizon', 'true')
  })
})

describe('BeaconCell — chips over a list of configurations', () => {
  const renderList = (beacons: BeaconConfig[]) =>
    render(
      <BeaconCell nodeId="n1" beacons={beacons} gameData={mockGameData} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" onOpenEdit={() => {}} />,
    )

  it('shows the beacon count and the modules per beacon over slots, without a +N badge for one configuration', () => {
    renderList([beacon])
    expect(screen.getByLabelText('Edit beacon')).toHaveTextContent('4')
    expect(screen.getByTestId('beacon-module-chip')).toHaveTextContent('2/2')
    expect(screen.queryByTestId('chip-more')).toBeNull()
  })

  it('shows the first configuration with a +N badge and lists them all in the tooltip', () => {
    renderList([beacon, { ...beacon, beaconCount: 8 }, { ...beacon, beaconCount: 2 }])
    expect(screen.getByLabelText('Edit beacon')).toHaveTextContent('4')
    expect(screen.getByTestId('chip-more')).toHaveTextContent('+2')
    const title = screen.getByLabelText('Edit beacon').getAttribute('title')!
    expect(title).toContain('4 × Beacon')
    expect(title).toContain('8 × Beacon')
    expect(title).toContain('2 × Beacon')
  })

  it('shows a beacon without a module as a beacon chip plus a dashed module chip', () => {
    renderList([{ ...beacon, modules: [] }])
    expect(screen.getByTestId('beacon-module-chip')).toHaveTextContent('0/2')
    expect(screen.getByTestId('beacon-module-chip').querySelector('.border-dashed')).not.toBeNull()
  })

  it('keeps the count and names the id of a module the loaded data set does not know', () => {
    renderList([{ ...beacon, modules: [{ moduleId: 'gone-module', count: 2 }] }])
    const chip = screen.getByLabelText('Edit beacon modules')
    expect(chip).toHaveTextContent('2/2')
    expect(chip.getAttribute('title')).toContain('gone-module')
    expect(chip.querySelector('.border-dashed')).toBeNull()
  })

  it('shows a partly filled beacon as used over slots, named by its module', () => {
    renderList([{ ...beacon, modules: [{ moduleId: 'speed-3', count: 1 }] }])
    const chip = screen.getByTestId('beacon-module-chip')
    expect(chip).toHaveTextContent('1/2')
    expect(chip.getAttribute('title')).toBe('Speed 3 × 1 per beacon')
  })

  it('shows the most used module of a mixed beacon and lists every module in the title', () => {
    const gd = structuredClone(mockGameData)
    gd.modules['eff-1'] = { ...speedModule, id: 'eff-1', name: 'Eff 1', category: 'efficiency', effects: { consumption: -0.3 } }
    render(
      <BeaconCell nodeId="n1" beacons={[{ ...beacon, modules: [{ moduleId: 'speed-3', count: 1 }, { moduleId: 'eff-1', count: 1 }] }]}
        gameData={gd} recipeId="iron-plate" machineId={undefined} recipeCategory="crafting" onOpenEdit={() => {}} />,
    )
    const chip = screen.getByTestId('beacon-module-chip')
    expect(chip).toHaveTextContent('2/2')
    expect(chip.getAttribute('title')).toBe('Speed 3 × 1 + Eff 1 × 1 per beacon')
  })

  it('rings the module chip when a module is unknown or there are more modules than slots', () => {
    const { unmount } = renderList([{ ...beacon, modules: [{ moduleId: 'gone-module', count: 1 }] }])
    expect(screen.getByTestId('beacon-module-chip')).toHaveTextContent('?')
    expect(screen.getByTestId('beacon-module-chip').className).toContain('ring')
    unmount()
    renderList([{ ...beacon, modules: [{ moduleId: 'speed-3', count: 3 }] }])
    expect(screen.getByTestId('beacon-module-chip')).toHaveTextContent('3/2')
    expect(screen.getByTestId('beacon-module-chip').className).toContain('ring')
  })

  it('shows two dashed placeholders when there is none: the beacon and its module slots', () => {
    render(
      <BeaconCell nodeId="n1" beacons={[]} gameData={horizonData()} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" onOpenEdit={() => {}} />,
    )
    expect(screen.getByLabelText('Add beacon')).toBeInTheDocument()
    const mod = screen.getByLabelText('Add beacon module')
    expect(mod).toHaveTextContent('0/2')
    expect(mod.querySelector('.border-dashed')).not.toBeNull()
  })

  it('creates the default configuration from the module placeholder too', () => {
    useBlockStore.getState().updateNodeBeacons('n1', [])
    renderList([])
    fireEvent.click(screen.getByLabelText('Add beacon module'))
    expect(screen.getByTestId('picker-heading')).toHaveTextContent('Add 1 × Beacon, fill its slots with')
    fireEvent.click(screen.getByText('Speed 3'))
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(updated.kind === 'game-recipe' && updated.beaconConfigs).toMatchObject([{ modules: [{ moduleId: 'speed-3', count: 2 }], beaconCount: 1 }])
  })

  it('opens the side panel from the beacon chip and the module chip', () => {
    const onOpenEdit = vi.fn()
    render(
      <BeaconCell nodeId="n1" beacons={[beacon]} gameData={mockGameData} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" onOpenEdit={onOpenEdit} />,
    )
    fireEvent.click(screen.getByLabelText('Edit beacon'))
    fireEvent.click(screen.getByTestId('beacon-module-chip'))
    expect(onOpenEdit).toHaveBeenCalledTimes(2)
  })

  it('creates the default configuration from the dashed plus picker, in one undoable command', () => {
    useBlockStore.getState().updateNodeBeacons('n1', [])
    useBlockStore.setState({ history: {} })
    const onOpenEdit = vi.fn()
    render(
      <BeaconCell nodeId="n1" beacons={[]} gameData={mockGameData} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" onOpenEdit={onOpenEdit} />,
    )
    fireEvent.click(screen.getByLabelText('Add beacon'))
    expect(screen.getByTestId('picker-heading')).toHaveTextContent('Add 1 × Beacon, fill its slots with')
    fireEvent.click(screen.getByText('Speed 3'))
    expect(screen.queryByTestId('picker')).toBeNull()
    expect(onOpenEdit).not.toHaveBeenCalled()
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(updated.kind === 'game-recipe' && updated.beaconConfigs).toMatchObject([{ modules: [{ moduleId: 'speed-3', count: 2 }], beaconCount: 1 }])
    useBlockStore.getState().undo()
    const undone = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(undone.kind === 'game-recipe' && undone.beaconConfigs).toBeUndefined()
  })

  it('closes the plus picker on Esc and on a press outside, without creating anything', () => {
    useBlockStore.getState().updateNodeBeacons('n1', [])
    render(
      <BeaconCell nodeId="n1" beacons={[]} gameData={mockGameData} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" onOpenEdit={() => {}} />,
    )
    fireEvent.click(screen.getByLabelText('Add beacon'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('picker')).toBeNull()
    fireEvent.click(screen.getByLabelText('Add beacon'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('picker')).toBeNull()
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(updated.kind === 'game-recipe' && updated.beaconConfigs).toBeUndefined()
  })

  it('fills the slots of an existing beacon from the dashed module chip', () => {
    const onOpenEdit = vi.fn()
    useBlockStore.getState().updateNodeBeacons('n1', [{ ...beacon, modules: [] }])
    render(
      <BeaconCell nodeId="n1" beacons={[{ ...beacon, modules: [] }]} gameData={mockGameData} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" onOpenEdit={onOpenEdit} />,
    )
    fireEvent.click(screen.getByTestId('beacon-module-chip'))
    expect(onOpenEdit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Speed 3'))
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(updated.kind === 'game-recipe' && updated.beaconConfigs).toMatchObject([{ modules: [{ moduleId: 'speed-3', count: 2 }], beaconCount: 4, modulesPerBeacon: 2 }])
  })

  it('fills only the first configuration and keeps the second', () => {
    const second: BeaconConfig = { ...beacon, beaconCount: 7 }
    const list = [{ ...beacon, modules: [] }, second]
    useBlockStore.getState().updateNodeBeacons('n1', list)
    render(
      <BeaconCell nodeId="n1" beacons={list} gameData={mockGameData} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" onOpenEdit={() => {}} />,
    )
    fireEvent.click(screen.getByTestId('beacon-module-chip'))
    fireEvent.click(screen.getByText('Speed 3'))
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(updated.kind === 'game-recipe' && updated.beaconConfigs).toEqual([{ ...beacon, modules: [{ moduleId: 'speed-3', count: 2 }] }, second])
  })

  it('does not open the other chip\'s picker when the row changes from no beacon to a beacon without a module', () => {
    const props = { nodeId: 'n1', gameData: mockGameData, recipeId: 'iron-plate', machineId: undefined, recipeCategory: 'crafting', onOpenEdit: () => {} }
    const { rerender } = render(<BeaconCell {...props} beacons={[]} />)
    fireEvent.click(screen.getByLabelText('Add beacon'))
    expect(screen.getByTestId('picker')).toBeInTheDocument()
    rerender(<BeaconCell {...props} beacons={[{ ...beacon, modules: [] }]} />)
    expect(screen.queryByTestId('picker')).toBeNull()
  })
})
