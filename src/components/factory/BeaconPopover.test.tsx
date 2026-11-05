import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BeaconModal } from './BeaconModal'
import { BeaconCell } from './BeaconPopover'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import type { GameData, BeaconConfig, GameRecipeNode, RecipeNode } from '../../data/types'

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

  describe('module picker and productivity', () => {
    const prodModule = {
      ...speedModule,
      id: 'prod-3',
      name: 'Prod 3',
      effects: { productivity: 0.1, speed: -0.15 },
    }

    function openPicker(allowProductivity: boolean) {
      const gameData: GameData = {
        ...mockGameData,
        recipes: { 'iron-plate': { ...mockGameData.recipes['iron-plate'], allowProductivity } },
        modules: { 'speed-3': speedModule, 'prod-3': prodModule },
      }
      render(
        <BeaconModal
          nodeId="n1"
          beacon={beacon}
          recipeId="iron-plate"
          machineId={undefined}
          recipeCategory="crafting"
          gameData={gameData}
          onClose={() => {}}
        />
      )
      fireEvent.click(screen.getByTitle('Speed 3'))
      return screen.getAllByTestId('beacon-module-option').map(e => e.getAttribute('data-module-id'))
    }

    it('hides productivity modules when the recipe disallows productivity', () => {
      expect(openPicker(false)).toEqual(['speed-3'])
    })

    it('offers productivity modules when the recipe allows productivity', () => {
      expect(openPicker(true)).toEqual(['prod-3', 'speed-3'])
    })
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

  it('notes that the row has no machine but productivity still applies when none is within the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    const gd = horizonData()
    gd.technologies.base.unlockedRecipes = ['iron-plate']
    gd.technologies.mods.unlockedRecipes = ['r-am1', 'r-beacon', 'r-speed']
    render(
      <BeaconModal nodeId="n1" beacon={beaconWithEntity} recipeId="iron-plate" machineId={undefined}
        recipeCategory="crafting" gameData={gd} onClose={() => {}} />,
    )
    expect(screen.getByTestId('no-machine-in-horizon')).toHaveTextContent(
      'No machine within research horizon: machine count and power are 0 for this row. Module and beacon productivity still applies to the output rates.',
    )
    const recipeEffects = screen.getByText('Recipe effects').parentElement!
    // No machine: the solver filters nothing, so the panel shows the beacon's effects (limited by the beacon entity only).
    expect(recipeEffects).toHaveTextContent('Speed:+600%')
    expect(recipeEffects).not.toHaveTextContent('No active effects')
  })

  it('drops a productivity module in a speed-only beacon from the recipe effects, as the solver does', () => {
    const gd = horizonData()
    gd.beacons.beacon.allowedEffects = ['speed', 'consumption']
    gd.machines.am1.allowedEffects = ['speed', 'consumption', 'productivity']
    gd.recipes['iron-plate'].allowProductivity = true
    gd.modules['prod-1'] = { ...gd.modules[Object.keys(gd.modules)[0]], id: 'prod-1', effects: { productivity: 0.1 }, limitation: [], limitationBlacklist: [] }
    render(
      <BeaconModal nodeId="n1" beacon={{ ...beaconWithEntity, moduleId: 'prod-1' }} recipeId="iron-plate"
        machineId="am1" recipeCategory="crafting" gameData={gd} onClose={() => {}} />,
    )
    const recipeEffects = screen.getByText('Recipe effects').parentElement!
    expect(recipeEffects).toHaveTextContent('No active effects')
  })
})

describe('BeaconModal — allowed effects', () => {
  function restrictedData(): GameData {
    const gd = horizonData()
    gd.modules = {
      'speed-3': speedModule,
      'prod-3': { ...speedModule, id: 'prod-3', name: 'Prod 3', category: 'productivity', effects: { productivity: 0.1, speed: -0.15 } },
    }
    gd.recipes['iron-plate'].allowProductivity = true
    return gd
  }

  function open(gd: GameData, config: BeaconConfig = beaconWithEntity) {
    useBlockStore.setState({ horizonTechnologyIds: [] })
    render(
      <BeaconModal nodeId="n1" beacon={config} recipeId="iron-plate" machineId={undefined}
        recipeCategory="crafting" gameData={gd} onClose={() => {}} />,
    )
  }

  it('omits a module whose effects the beacon does not allow', () => {
    open(restrictedData())
    fireEvent.click(screen.getByTitle('Speed 3'))
    expect(screen.getAllByTestId('beacon-module-option').map(e => e.getAttribute('data-module-id'))).toEqual(['speed-3'])
    expect(screen.queryByTestId('module-not-allowed')).not.toBeInTheDocument()
  })

  it('offers the module when the beacon allows its effects', () => {
    const gd = restrictedData()
    gd.beacons.beacon.allowedEffects = ['speed', 'consumption', 'productivity']
    open(gd)
    fireEvent.click(screen.getByTitle('Speed 3'))
    expect(screen.getAllByTestId('beacon-module-option').map(e => e.getAttribute('data-module-id'))).toEqual(['prod-3', 'speed-3'])
  })

  it('notes a selected module the beacon cannot take', () => {
    open(restrictedData(), { ...beaconWithEntity, moduleId: 'prod-3' })
    expect(screen.getByTestId('module-not-allowed')).toHaveTextContent('Prod 3 cannot be inserted in Beacon')
  })

  it('creates the beacon with a module the beacon allows', () => {
    useBlockStore.setState({ horizonTechnologyIds: [] })
    const gd = restrictedData()
    // 'Prod 3' sorts before 'Speed 3', so without the check it would be the default.
    render(
      <BeaconCell nodeId="n1" beacons={[]} gameData={gd} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" />,
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

describe('BeaconModal — apply to every row of the recipe', () => {
  const second: RecipeNode = { kind: 'game-recipe', id: 'n2', recipeId: 'iron-plate', modules: [], byproductPolicy: {} }
  const rows = () => useBlockStore.getState().blocks[0].rootPlan.nodes as GameRecipeNode[]
  const renderModal = () => render(
    <BeaconModal nodeId="n1" beacon={beacon} recipeId="iron-plate" machineId={undefined}
      recipeCategory="crafting" gameData={mockGameData} onClose={() => {}} />,
  )

  it('copies the beacon to the other rows of the recipe', () => {
    const block = useBlockStore.getState().blocks[0]
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [node, second] } }],
    })
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Apply to every row of this recipe (2)' }))
    expect(rows().find(r => r.id === 'n2')!.beaconConfig).toEqual(beacon)
  })

  it('has no such button with a single row', () => {
    renderModal()
    expect(screen.queryByRole('button', { name: /Apply to every row/ })).not.toBeInTheDocument()
  })
})

describe('BeaconCell — chips over a list of configurations', () => {
  const renderList = (beacons: BeaconConfig[]) =>
    render(
      <BeaconCell nodeId="n1" beacons={beacons} gameData={mockGameData} recipeId="iron-plate"
        machineId={undefined} recipeCategory="crafting" />,
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
})
