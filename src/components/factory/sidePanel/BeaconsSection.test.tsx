import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BeaconsSection } from './BeaconsSection'
import { EffectsSection } from './EffectsSection'
import { useBlockStore, makeEmptyBlock } from '../../../store/blockStore'
import type { BeaconConfig, GameData, GameRecipeNode } from '../../../data/types'

const speedModule = {
  id: 'speed-3', name: 'Speed 3', iconPath: '', category: 'speed', effects: { speed: 0.5, consumption: 0.7 },
  limitation: [], limitationBlacklist: [], tier: 3,
}
const prodModule = { ...speedModule, id: 'prod-3', name: 'Prod 3', category: 'productivity', effects: { productivity: 0.1, speed: -0.15 } }

/** Fresh each call: an assembler within the base technology, a beacon and modules behind the "mods" one. */
function makeGameData(): GameData {
  const placer = (id: string, placeResult?: string) =>
    ({ id, name: id, type: 'item' as const, iconPath: '', hidden: false, subgroup: '', order: '', placeResult })
  const maker = (id: string, itemId: string) => ({
    id, name: id, hidden: false, category: 'crafting', craftingTime: 1, ingredients: [], madeIn: [],
    allowProductivity: false, mainProduct: undefined, subgroup: '', order: '',
    products: [{ itemId, type: 'item' as const, amount: 1 }],
  })
  return {
    factorioVersion: '2.0.0', modSet: {},
    items: { am1: placer('am1', 'am1'), 'beacon-item': placer('beacon-item', 'beacon'), 'speed-3': placer('speed-3'), 'prod-3': placer('prod-3') },
    recipes: {
      'iron-plate': { ...maker('iron-plate', 'iron-plate'), name: 'Iron Plate' },
      'r-am1': maker('r-am1', 'am1'),
      'r-beacon': maker('r-beacon', 'beacon-item'),
      'r-speed': maker('r-speed', 'speed-3'),
      'r-prod': maker('r-prod', 'prod-3'),
    },
    machines: {
      am1: {
        id: 'am1', name: 'Am1', type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 1, energyType: 'electric',
        drainKw: 0, moduleSlots: 2, allowedEffects: ['speed'], craftingCategories: ['crafting'], iconPath: '', hidden: false,
      },
    },
    modules: { 'speed-3': { ...speedModule }, 'prod-3': { ...prodModule } },
    beacons: {
      beacon: { id: 'beacon', name: 'Beacon', iconPath: '', hidden: false, moduleSlots: 2, distributionEfficiency: 1.5, allowedEffects: ['speed', 'consumption'] },
    },
    defaultMachines: { crafting: 'am1' },
    itemGroups: {}, itemSubgroups: {},
    technologies: {
      base: { id: 'base', name: 'Base', prerequisites: [], unlockedRecipes: ['iron-plate', 'r-am1'], iconPath: '' },
      mods: { id: 'mods', name: 'Mods', prerequisites: [], unlockedRecipes: ['r-beacon', 'r-speed', 'r-prod'], iconPath: '' },
    },
    startingRecipes: [],
  }
}

const beacon = (over: Partial<BeaconConfig> = {}): BeaconConfig =>
  ({ beaconId: 'beacon', moduleId: 'speed-3', beaconCount: 4, modulesPerBeacon: 2, distributionEfficiency: 1.5, ...over })

const rowNode = (over: Partial<GameRecipeNode> = {}): GameRecipeNode =>
  ({ kind: 'game-recipe', id: 'n1', recipeId: 'iron-plate', modules: [], byproductPolicy: {}, ...over })

function setRows(...rows: GameRecipeNode[]) {
  const block = makeEmptyBlock('Test')
  useBlockStore.setState({ blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: rows } }], activeBlockId: block.id, history: {}, horizonTechnologyIds: [] })
}
const nodes = () => useBlockStore.getState().blocks[0].rootPlan.nodes as GameRecipeNode[]
const storedBeacon = () => nodes()[0].beaconConfig

/** The section as the panel wires it: the data model's single `beaconConfig` adapted to a list. */
function renderBeacons(gameData: GameData, node: GameRecipeNode = rowNode({ beaconConfig: beacon() })) {
  setRows(node)
  render(
    <BeaconsSection
      node={node}
      configs={node.beaconConfig ? [node.beaconConfig] : []}
      gameData={gameData}
      onChange={configs => useBlockStore.getState().updateNodeBeacon(node.id, configs[0])}
    />,
  )
}

beforeEach(() => {
  setRows(rowNode())
})

describe('BeaconsSection — the card', () => {
  it('shows the beacon count, the type, one button per module slot and the efficiency line', () => {
    renderBeacons(makeGameData())
    expect(screen.getByLabelText('Beacon count')).toHaveValue(4)
    expect(screen.getByTestId('beacon-type-button')).toHaveAttribute('title', 'Beacon')
    expect(screen.getAllByTestId('beacon-module-slot')).toHaveLength(2)
    expect(screen.getByTestId('beacon-summary')).toHaveTextContent('150% efficiency')
  })

  it('updates the beacon count', () => {
    renderBeacons(makeGameData())
    fireEvent.change(screen.getByLabelText('Beacon count'), { target: { value: '8' } })
    expect(storedBeacon()?.beaconCount).toBe(8)
  })

  it('removes the configuration', () => {
    renderBeacons(makeGameData())
    fireEvent.click(screen.getByRole('button', { name: 'Remove beacon configuration' }))
    expect(storedBeacon()).toBeUndefined()
  })

  it('shows a beacon without a module as empty slots and empties every slot together', () => {
    renderBeacons(makeGameData(), rowNode({ beaconConfig: beacon({ moduleId: undefined }) }))
    expect(screen.getByTestId('beacon-summary')).toHaveTextContent('no module')
    const slots = screen.getAllByTestId('beacon-module-slot')
    expect(slots.map(s => s.getAttribute('aria-label'))).toEqual(['Beacon module slot 1: empty', 'Beacon module slot 2: empty'])
  })

  it('sets the module of the whole configuration from any slot, and clears it', () => {
    renderBeacons(makeGameData(), rowNode({ beaconConfig: beacon({ moduleId: undefined }) }))
    fireEvent.click(screen.getAllByTestId('beacon-module-slot')[1])
    fireEvent.click(screen.getByTestId('beacon-module-option'))
    expect(storedBeacon()?.moduleId).toBe('speed-3')
    expect(storedBeacon()?.modulesPerBeacon).toBe(2)
  })
})

describe('BeaconsSection — one configuration for now', () => {
  it('disables the add button once the row has a configuration, and says why', () => {
    renderBeacons(makeGameData())
    const add = screen.getByRole('button', { name: '+ Add beacon configuration' })
    expect(add).toBeDisabled()
    expect(add).toHaveAttribute('title', 'One beacon configuration per recipe for now')
  })

  it('adds a default configuration while the row has none, and removing the card re-enables the button', () => {
    renderBeacons(makeGameData(), rowNode())
    fireEvent.click(screen.getByRole('button', { name: '+ Add beacon configuration' }))
    expect(storedBeacon()).toMatchObject({ beaconId: 'beacon', moduleId: 'speed-3', beaconCount: 4, modulesPerBeacon: 2 })
  })

  it('re-enables the add button without a configuration', () => {
    renderBeacons(makeGameData(), rowNode())
    expect(screen.getByRole('button', { name: '+ Add beacon configuration' })).toBeEnabled()
  })
})

describe('BeaconsSection — module picker and productivity', () => {
  function openSlots(allowProductivity: boolean, allowed: GameData['beacons'][string]['allowedEffects'] = ['speed', 'consumption']) {
    const gd = makeGameData()
    gd.recipes['iron-plate'].allowProductivity = allowProductivity
    gd.beacons.beacon.allowedEffects = allowed
    renderBeacons(gd)
    fireEvent.click(screen.getAllByTestId('beacon-module-slot')[0])
    return screen.getAllByTestId('beacon-module-option').map(e => e.getAttribute('data-module-id'))
  }

  it('omits a module whose effects the beacon does not allow', () => {
    expect(openSlots(true)).toEqual(['speed-3'])
  })

  it('hides productivity modules when the recipe disallows productivity', () => {
    expect(openSlots(false, ['speed', 'consumption', 'productivity'])).toEqual(['speed-3'])
  })

  it('offers productivity modules when the beacon and the recipe allow them', () => {
    expect(openSlots(true, ['speed', 'consumption', 'productivity'])).toEqual(['prod-3', 'speed-3'])
  })

  it('notes a selected module the beacon cannot take', () => {
    const gd = makeGameData()
    gd.recipes['iron-plate'].allowProductivity = true
    renderBeacons(gd, rowNode({ beaconConfig: beacon({ moduleId: 'prod-3' }) }))
    expect(screen.getByTestId('module-not-allowed')).toHaveTextContent('Prod 3 cannot be inserted in Beacon')
  })
})

describe('BeaconsSection — research horizon', () => {
  it('omits a beacon outside the horizon and marks the configured one', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    renderBeacons(makeGameData())
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    fireEvent.click(screen.getByTestId('beacon-type-button'))
    expect(screen.queryAllByTestId('beacon-option').map(e => e.getAttribute('data-beacon-id'))).not.toContain('beacon')
    expect(screen.getAllByTestId('beyond-horizon').length).toBeGreaterThan(0)
  })

  it('lists the beacon within the horizon', () => {
    renderBeacons(makeGameData())
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'mods'] })
    fireEvent.click(screen.getByTestId('beacon-type-button'))
    expect(screen.getAllByTestId('beacon-option').map(e => e.getAttribute('data-beacon-id'))).toEqual(['beacon'])
    expect(screen.queryByTestId('beyond-horizon')).not.toBeInTheDocument()
  })

  it('notes that the row has no machine and disables adding when none is within the horizon', () => {
    const gd = makeGameData()
    gd.technologies.base.unlockedRecipes = ['iron-plate']
    gd.technologies.mods.unlockedRecipes = ['r-am1', 'r-beacon', 'r-speed']
    setRows(rowNode())
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    render(<BeaconsSection node={rowNode()} configs={[]} gameData={gd} onChange={() => {}} />)
    const add = screen.getByTestId('add-beacon-config')
    expect(add).toBeDisabled()
    expect(add).toHaveAttribute('title', 'No machine within research horizon')
  })

  it('disables adding when no beacon is within the horizon', () => {
    setRows(rowNode())
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    render(<BeaconsSection node={rowNode()} configs={[]} gameData={makeGameData()} onChange={() => {}} />)
    expect(screen.getByTestId('add-beacon-config')).toHaveAttribute('title', 'No beacon within the research horizon')
  })

  it('disables adding when no module is within the horizon', () => {
    const gd = makeGameData()
    gd.technologies.base.unlockedRecipes = ['iron-plate', 'r-am1', 'r-beacon']
    gd.technologies.mods.unlockedRecipes = ['r-speed', 'r-prod']
    setRows(rowNode())
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    render(<BeaconsSection node={rowNode()} configs={[]} gameData={gd} onChange={() => {}} />)
    expect(screen.getByTestId('add-beacon-config')).toHaveAttribute('title', 'No module within the research horizon')
  })
})

describe('BeaconsSection — apply to every row of the recipe', () => {
  it('copies the beacon to the other rows of the recipe', () => {
    const first = rowNode({ beaconConfig: beacon() })
    setRows(first, rowNode({ id: 'n2' }))
    render(<BeaconsSection node={first} configs={[beacon()]} gameData={makeGameData()} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply to every row of this recipe (2)' }))
    expect(nodes().find(r => r.id === 'n2')!.beaconConfig).toEqual(beacon())
  })

  it('has no such button with a single row', () => {
    renderBeacons(makeGameData())
    expect(screen.queryByRole('button', { name: /Apply to every row/ })).not.toBeInTheDocument()
  })
})

describe('EffectsSection', () => {
  const renderEffects = (gd: GameData, node: GameRecipeNode) =>
    render(<EffectsSection node={node} beacons={node.beaconConfig ? [node.beaconConfig] : []} gameData={gd} />)

  it('lists speed, productivity and energy with the machine, beacon and total columns', () => {
    const gd = makeGameData()
    renderEffects(gd, rowNode({ machineId: 'am1', beaconConfig: beacon() }))
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['', 'Machine', 'Beacons', 'Total'])
    // 0.5 speed × 1.5 efficiency × 2 modules × 4 beacons
    expect(screen.getByTestId('effect-total-speed')).toHaveTextContent('+600%')
    expect(screen.getByText('Beacon effect = module effect × efficiency × modules per beacon × beacons. All sources add up.', { exact: false })).toBeInTheDocument()
  })

  it('shows no effects as dashes', () => {
    renderEffects(makeGameData(), rowNode({ machineId: 'am1' }))
    expect(screen.getByTestId('effect-total-speed')).toHaveTextContent('–')
    expect(screen.queryByTestId('recipe-effects-note')).not.toBeInTheDocument()
  })

  it('notes the effects the recipe does not allow and counts none of them, as the solver does', () => {
    const gd = makeGameData()
    gd.machines.am1.allowedEffects = ['speed', 'consumption', 'productivity']
    gd.recipes['iron-plate'].allowProductivity = true
    renderEffects(gd, rowNode({ machineId: 'am1', beaconConfig: beacon({ moduleId: 'prod-3' }) }))
    expect(screen.getByTestId('recipe-effects-note')).toHaveTextContent('productivity of the beacons')
    expect(screen.getByTestId('effect-total-productivity')).toHaveTextContent('–')
  })

  it('counts the beacon effects with no machine in the horizon, limited by the beacon entity only', () => {
    const gd = makeGameData()
    gd.technologies.base.unlockedRecipes = ['iron-plate']
    gd.technologies.mods.unlockedRecipes = ['r-am1', 'r-beacon', 'r-speed']
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    renderEffects(gd, rowNode({ beaconConfig: beacon() }))
    expect(screen.getByTestId('effect-total-speed')).toHaveTextContent('+600%')
  })
})
