import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BeaconModal } from './BeaconModal'
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

describe('BeaconModal', () => {
  it('renders the beacon count field', () => {
    render(
      <BeaconModal
        nodeId="n1"
        beacon={beacon}
        recipeId="iron-plate"
        machineId={undefined}
        recipeCategory="crafting"
        gameData={mockGameData}
        onClose={() => {}}
      />
    )
    expect(screen.getByDisplayValue('4')).toBeInTheDocument()
  })

  it('calls updateNodeBeacon(undefined) when Remove beacon is clicked', () => {
    render(
      <BeaconModal
        nodeId="n1"
        beacon={beacon}
        recipeId="iron-plate"
        machineId={undefined}
        recipeCategory="crafting"
        gameData={mockGameData}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Remove beacon'))
    const updatedNode = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    if (updatedNode.kind === 'game-recipe') {
      expect(updatedNode.beaconConfig).toBeUndefined()
    }
  })

  it('updates beaconCount on input change', () => {
    render(
      <BeaconModal
        nodeId="n1"
        beacon={beacon}
        recipeId="iron-plate"
        machineId={undefined}
        recipeCategory="crafting"
        gameData={mockGameData}
        onClose={() => {}}
      />
    )
    const input = screen.getByDisplayValue('4')
    fireEvent.change(input, { target: { value: '8' } })
    const updatedNode = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    if (updatedNode.kind === 'game-recipe') {
      expect(updatedNode.beaconConfig?.beaconCount).toBe(8)
    }
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
      beacon: { id: 'beacon', name: 'Beacon', iconPath: '', hidden: false, moduleSlots: 2, distributionEfficiency: 1.5, allowedEffects: ['speed'] },
    },
    defaultMachines: { crafting: 'am1' },
    technologies: {
      base: { id: 'base', name: 'Base', prerequisites: [], unlockedRecipes: ['iron-plate', 'r-am1'], iconPath: '' },
      mods: { id: 'mods', name: 'Mods', prerequisites: [], unlockedRecipes: ['r-beacon', 'r-speed'], iconPath: '' },
    },
  }
}

const beaconWithEntity: BeaconConfig = { ...beacon, beaconId: 'beacon' }

describe('BeaconModal — research horizon', () => {
  it('omits a beacon outside the horizon and marks the configured one', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    render(
      <BeaconModal nodeId="n1" beacon={beaconWithEntity} recipeId="iron-plate" machineId={undefined}
        recipeCategory="crafting" gameData={horizonData()} onClose={() => {}} />,
    )
    fireEvent.click(screen.getByTitle('Beacon'))
    expect(screen.queryAllByTestId('beacon-option').map(e => e.getAttribute('data-beacon-id'))).not.toContain('beacon')
    expect(screen.getAllByTestId('beyond-horizon').length).toBeGreaterThan(0)
  })

  it('lists the beacon within the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'mods'] })
    render(
      <BeaconModal nodeId="n1" beacon={beaconWithEntity} recipeId="iron-plate" machineId={undefined}
        recipeCategory="crafting" gameData={horizonData()} onClose={() => {}} />,
    )
    fireEvent.click(screen.getByTitle('Beacon'))
    expect(screen.getAllByTestId('beacon-option').map(e => e.getAttribute('data-beacon-id'))).toEqual(['beacon'])
    expect(screen.queryByTestId('beyond-horizon')).not.toBeInTheDocument()
  })

  it('notes that beacon effects do not apply when no machine is within the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    const gd = horizonData()
    gd.technologies.base.unlockedRecipes = ['iron-plate']
    gd.technologies.mods.unlockedRecipes = ['r-am1', 'r-beacon', 'r-speed']
    render(
      <BeaconModal nodeId="n1" beacon={beaconWithEntity} recipeId="iron-plate" machineId={undefined}
        recipeCategory="crafting" gameData={gd} onClose={() => {}} />,
    )
    expect(screen.getByTestId('no-machine-in-horizon')).toBeVisible()
    const recipeEffects = screen.getByText('Recipe effects').parentElement!
    expect(recipeEffects).toHaveTextContent('No active effects')
  })
})

describe('BeaconCell — research horizon', () => {
  function renderCell(gameData: GameData) {
    return render(
      <BeaconCell nodeId="n1" beacon={undefined} gameData={gameData} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" />,
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
})
