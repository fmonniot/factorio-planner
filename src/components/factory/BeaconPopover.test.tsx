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
  moduleId: 'speed-3',
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
  beaconConfig: beacon,
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

  it('creates the beacon with a module the beacon allows', () => {
    useBlockStore.setState({ horizonTechnologyIds: [] })
    const gd = restrictedData()
    // 'Prod 3' sorts before 'Speed 3', so without the check it would be the default.
    render(
      <BeaconCell nodeId="n1" beacons={[]} gameData={gd} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" onOpenEdit={() => {}} />,
    )
    fireEvent.click(screen.getByLabelText('Add beacon'))
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(updated.kind === 'game-recipe' && updated.beaconConfig?.moduleId).toBe('speed-3')
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
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(updated.kind === 'game-recipe' && updated.beaconConfig?.beaconId).toBe('beacon')
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
    renderList([{ ...beacon, moduleId: undefined }])
    expect(screen.getByTestId('beacon-module-chip')).toHaveTextContent('0/2')
    expect(screen.getByTestId('beacon-module-chip').querySelector('.border-dashed')).not.toBeNull()
  })

  it('keeps the count and names the id of a module the loaded data set does not know', () => {
    renderList([{ ...beacon, moduleId: 'gone-module' }])
    const chip = screen.getByLabelText('Edit beacon modules')
    expect(chip).toHaveTextContent('2/2')
    expect(chip.getAttribute('title')).toContain('gone-module')
    expect(chip.querySelector('.border-dashed')).toBeNull()
  })

  it('shows a dashed plus when there is none', () => {
    renderList([])
    expect(screen.getByLabelText('Add beacon')).toBeInTheDocument()
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

  it('creates the default configuration from the dashed plus and opens the side panel', () => {
    const onOpenEdit = vi.fn()
    render(
      <BeaconCell nodeId="n1" beacons={[]} gameData={mockGameData} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" onOpenEdit={onOpenEdit} />,
    )
    fireEvent.click(screen.getByLabelText('Add beacon'))
    expect(onOpenEdit).toHaveBeenCalledTimes(1)
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(updated.kind === 'game-recipe' && updated.beaconConfig).toMatchObject({ moduleId: 'speed-3', beaconCount: 4 })
  })
})
