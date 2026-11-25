import { useState } from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { BeaconsSection } from './BeaconsSection'
import { fitModules } from './moduleSlots'
import { expectTip } from '../../../test/byTip'
import { EffectsSection } from './EffectsSection'
import { useBlockStore, makeEmptyBlock } from '../../../store/blockStore'
import type { BeaconConfig, GameData, GameRecipeNode } from '../../../data/types'

const speedModule = {
  id: 'speed-3', name: 'Speed 3', iconPath: '', category: 'speed', effects: { speed: 0.5, consumption: 0.7 },
  limitation: [], limitationBlacklist: [], tier: 3,
}
// Named to sort last, so the default module of a new configuration stays Speed 3.
const effModule = { ...speedModule, id: 'eff-1', name: 'Z Eff 1', category: 'efficiency', effects: { consumption: -0.3 } }
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
    items: { am1: placer('am1', 'am1'), 'beacon-item': placer('beacon-item', 'beacon'), 'speed-3': placer('speed-3'), 'prod-3': placer('prod-3'), 'eff-1': placer('eff-1') },
    recipes: {
      'iron-plate': { ...maker('iron-plate', 'iron-plate'), name: 'Iron Plate' },
      'r-am1': maker('r-am1', 'am1'),
      'r-beacon': maker('r-beacon', 'beacon-item'),
      'r-speed': maker('r-speed', 'speed-3'),
      'r-prod': maker('r-prod', 'prod-3'),
      'r-eff': maker('r-eff', 'eff-1'),
    },
    machines: {
      am1: {
        id: 'am1', name: 'Am1', type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 1, energyType: 'electric',
        drainKw: 0, moduleSlots: 2, allowedEffects: ['speed'], craftingCategories: ['crafting'], iconPath: '', hidden: false,
      },
    },
    modules: { 'speed-3': { ...speedModule }, 'prod-3': { ...prodModule }, 'eff-1': { ...effModule } },
    beacons: {
      beacon: { id: 'beacon', name: 'Beacon', iconPath: '', hidden: false, moduleSlots: 2, distributionEfficiency: 1.5, allowedEffects: ['speed', 'consumption'] },
    },
    defaultMachines: { crafting: 'am1' },
    itemGroups: {}, itemSubgroups: {},
    technologies: {
      base: { id: 'base', name: 'Base', prerequisites: [], unlockedRecipes: ['iron-plate', 'r-am1'], iconPath: '' },
      mods: { id: 'mods', name: 'Mods', prerequisites: [], unlockedRecipes: ['r-beacon', 'r-speed', 'r-prod', 'r-eff'], iconPath: '' },
    },
    startingRecipes: [],
  }
}

const beacon = (over: Partial<BeaconConfig> = {}): BeaconConfig =>
  ({ beaconId: 'beacon', modules: [{ moduleId: 'speed-3', count: 2 }], beaconCount: 4, modulesPerBeacon: 2, distributionEfficiency: 1.5, ...over })

const rowNode = (over: Partial<GameRecipeNode> = {}): GameRecipeNode =>
  ({ kind: 'game-recipe', id: 'n1', recipeId: 'iron-plate', modules: [], byproductPolicy: {}, ...over })

function setRows(...rows: GameRecipeNode[]) {
  const block = makeEmptyBlock('Test')
  useBlockStore.setState({ blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: rows } }], activeBlockId: block.id, history: {}, horizonTechnologyIds: [] })
}
const nodes = () => useBlockStore.getState().blocks[0].rootPlan.nodes as GameRecipeNode[]
const storedConfigs = () => nodes()[0].beaconConfigs
const storedBeacon = () => storedConfigs()?.[0]

/** The section as the panel wires it: reading the first row from the store and writing its list back. */
function StoreBeacons({ gameData }: { gameData: GameData }) {
  const node = useBlockStore(s => s.blocks[0].rootPlan.nodes[0]) as GameRecipeNode
  return (
    <BeaconsSection
      node={node}
      configs={node.beaconConfigs ?? []}
      gameData={gameData}
      onChange={configs => useBlockStore.getState().updateNodeBeacons(node.id, configs)}
    />
  )
}

function renderBeacons(gameData: GameData, node: GameRecipeNode = rowNode({ beaconConfigs: [beacon()] })) {
  setRows(node)
  render(<StoreBeacons gameData={gameData} />)
}

beforeEach(() => {
  setRows(rowNode())
})

describe('BeaconsSection — the card', () => {
  it('shows the beacon count, the type, one button per module slot and the efficiency line', () => {
    renderBeacons(makeGameData())
    expect(screen.getByLabelText('Beacon count')).toHaveValue(4)
    expect(screen.getByTestId('beacon-type-button')).toHaveAttribute('data-tip', 'Beacon')
    expect(screen.getByTestId('beacon-type-button')).not.toHaveAttribute('title')
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
    const remove = screen.getByRole('button', { name: 'Remove beacon configuration' })
    expect(remove).toHaveAccessibleDescription('Remove this beacon configuration')
    expect(remove).not.toHaveAttribute('title')
    fireEvent.click(screen.getByRole('button', { name: 'Remove beacon configuration' }))
    expect(storedConfigs()).toBeUndefined()
  })

  it('shows a beacon without a module as empty slots', () => {
    renderBeacons(makeGameData(), rowNode({ beaconConfigs: [beacon({ modules: [] })] }))
    expect(screen.getByTestId('beacon-summary')).toHaveTextContent('no module')
    const slots = screen.getAllByTestId('beacon-module-slot')
    expect(slots.map(s => s.getAttribute('aria-label'))).toEqual(['Beacon module slot 1: empty', 'Beacon module slot 2: empty'])
  })

  it('shows the placeholder "Slots/beacon" field when there is no beacon data', () => {
    const gd = makeGameData()
    gd.beacons = {}
    renderBeacons(gd, rowNode({ beaconConfigs: [beacon({ beaconId: undefined })] }))
    expect(screen.getByText('Slots/beacon')).toBeInTheDocument()
    expect(screen.queryByText('Modules/beacon')).not.toBeInTheDocument()
  })
})

describe('BeaconsSection — module semantics and removal', () => {
  const slotLabels = () => screen.getAllByTestId('beacon-module-slot').map(s => s.getAttribute('aria-label'))

  it('has no one-module-type hint any more', () => {
    renderBeacons(makeGameData())
    expect(screen.queryByTestId('beacon-module-hint')).toBeNull()
  })

  it('sets one slot of an empty beacon, and leaves the others empty', () => {
    renderBeacons(makeGameData(), rowNode({ beaconConfigs: [beacon({ modules: [] })] }))
    fireEvent.click(screen.getAllByTestId('beacon-module-slot')[1])
    fireEvent.click(screen.getAllByTestId('beacon-module-option').find(o => o.getAttribute('data-module-id') === 'speed-3')!)
    expect(storedBeacon()?.modules).toEqual([{ moduleId: 'speed-3', count: 1 }])
    expect(storedBeacon()?.modulesPerBeacon).toBe(2)
    expect(slotLabels()).toEqual(['Beacon module slot 1: Speed 3', 'Beacon module slot 2: empty'])
  })

  it('empties one slot of a full beacon and keeps the contribution of the other', () => {
    renderBeacons(makeGameData())
    fireEvent.click(screen.getAllByTestId('beacon-module-slot')[1])
    fireEvent.click(screen.getByTestId('beacon-module-option-empty'))
    expect(storedBeacon()?.modules).toEqual([{ moduleId: 'speed-3', count: 1 }])
    expect(screen.getByTestId('beacon-summary')).toHaveTextContent('speed')
  })

  it('sets the second slot to another module, leaving the first', () => {
    renderBeacons(makeGameData())
    fireEvent.click(screen.getAllByTestId('beacon-module-slot')[1])
    fireEvent.click(screen.getAllByTestId('beacon-module-option').find(o => o.getAttribute('data-module-id') === 'eff-1')!)
    expect(storedBeacon()?.modules).toEqual([{ moduleId: 'speed-3', count: 1 }, { moduleId: 'eff-1', count: 1 }])
    expect(slotLabels()).toEqual(['Beacon module slot 1: Speed 3', 'Beacon module slot 2: Z Eff 1'])
  })

  it('does not hand an open popover to the card that slides into a removed one\'s place', () => {
    const gd = makeGameData()
    const node = rowNode()
    function Wrapper() {
      const [configs, setConfigs] = useState<BeaconConfig[]>([beacon(), beacon({ beaconCount: 7 })])
      return <BeaconsSection node={node} configs={configs} gameData={gd} onChange={setConfigs} />
    }
    setRows(node)
    render(<Wrapper />)
    fireEvent.click(screen.getAllByTestId('beacon-type-button')[0])
    expect(screen.getAllByTestId('beacon-option').length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove beacon configuration' })[0])
    expect(screen.getAllByTestId('beacon-card')).toHaveLength(1)
    expect(screen.queryAllByTestId('beacon-option')).toHaveLength(0)
  })
})

describe('BeaconsSection — changes from outside', () => {
  it('closes an open picker after undo, so a pick lands on the configuration it was opened for', () => {
    const a = beacon({ beaconCount: 4 })
    const b = beacon({ beaconCount: 7 })
    renderBeacons(makeGameData(), rowNode({ beaconConfigs: [a, b] }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove beacon configuration' })[0])
    expect(storedConfigs()).toEqual([b])
    fireEvent.click(screen.getByTestId('beacon-type-button'))
    expect(screen.getAllByTestId('beacon-option').length).toBeGreaterThan(0)
    act(() => useBlockStore.getState().undo())
    expect(storedConfigs()).toEqual([a, b])
    expect(screen.queryAllByTestId('beacon-option')).toHaveLength(0)
    expect(screen.getAllByLabelText('Beacon count').map(i => (i as HTMLInputElement).value)).toEqual(['4', '7'])
  })

  it('keeps a picker open across the section\'s own edits', () => {
    renderBeacons(makeGameData(), rowNode({ beaconConfigs: [beacon(), beacon({ beaconCount: 7 })] }))
    fireEvent.click(screen.getAllByTestId('beacon-type-button')[1])
    fireEvent.change(screen.getAllByLabelText('Beacon count')[0], { target: { value: '5' } })
    expect(screen.getAllByTestId('beacon-option').length).toBeGreaterThan(0)
  })
})

describe('BeaconsSection — several configurations', () => {
  it('keeps the add button enabled with one configuration, without the old limit title', () => {
    renderBeacons(makeGameData())
    const add = screen.getByRole('button', { name: '+ Add beacon configuration' })
    expect(add).toBeEnabled()
    expectTip(add, 'Add a beacon configuration', { describe: false })
    expect(add).not.toHaveAccessibleDescription()
  })

  it('adds a second card with the default configuration', () => {
    renderBeacons(makeGameData())
    fireEvent.click(screen.getByTestId('add-beacon-config'))
    expect(screen.getAllByTestId('beacon-card')).toHaveLength(2)
    expect(storedConfigs()).toHaveLength(2)
    expect(storedConfigs()![1]).toMatchObject({ beaconId: 'beacon', modules: [{ moduleId: 'speed-3', count: 2 }], beaconCount: 1, modulesPerBeacon: 2 })
  })

  it('adds a default configuration while the row has none', () => {
    renderBeacons(makeGameData(), rowNode())
    fireEvent.click(screen.getByRole('button', { name: '+ Add beacon configuration' }))
    expect(storedBeacon()).toMatchObject({ beaconId: 'beacon', modules: [{ moduleId: 'speed-3', count: 2 }], beaconCount: 1, modulesPerBeacon: 2 })
  })

  it('edits the second configuration only', () => {
    renderBeacons(makeGameData(), rowNode({ beaconConfigs: [beacon(), beacon({ beaconCount: 7 })] }))
    fireEvent.change(screen.getAllByLabelText('Beacon count')[1], { target: { value: '8' } })
    expect(storedConfigs()!.map(c => c.beaconCount)).toEqual([4, 8])
  })

  it('removes the first card and keeps the second', () => {
    renderBeacons(makeGameData(), rowNode({ beaconConfigs: [beacon(), beacon({ beaconCount: 7 })] }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove beacon configuration' })[0])
    expect(storedConfigs()!.map(c => c.beaconCount)).toEqual([7])
  })

  it('drops the key when the last configuration is removed', () => {
    renderBeacons(makeGameData(), rowNode({ beaconConfigs: [beacon()] }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove beacon configuration' }))
    expect('beaconConfigs' in nodes()[0]).toBe(false)
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
    expect(openSlots(true)).toEqual(['speed-3', 'eff-1'])
  })

  it('hides productivity modules when the recipe disallows productivity', () => {
    expect(openSlots(false, ['speed', 'consumption', 'productivity'])).toEqual(['speed-3', 'eff-1'])
  })

  it('offers productivity modules when the beacon and the recipe allow them', () => {
    expect(openSlots(true, ['speed', 'consumption', 'productivity'])).toEqual(['prod-3', 'speed-3', 'eff-1'])
  })

  it('notes a selected module the beacon cannot take', () => {
    const gd = makeGameData()
    gd.recipes['iron-plate'].allowProductivity = true
    renderBeacons(gd, rowNode({ beaconConfigs: [beacon({ modules: [{ moduleId: 'prod-3', count: 2 }] })] }))
    expect(screen.getByTestId('module-not-allowed')).toHaveTextContent('Ringed modules cannot be inserted in Beacon')
    expect(screen.getAllByTestId('beacon-module-slot')[0]).toHaveAttribute('data-misfit', 'effect')
  })

  it('rings a module the recipe does not take, though the beacon allows productivity', () => {
    const gd = makeGameData()
    gd.recipes['iron-plate'].allowProductivity = false
    gd.beacons.beacon.allowedEffects = ['speed', 'consumption', 'productivity']
    renderBeacons(gd, rowNode({ beaconConfigs: [beacon({ modules: [{ moduleId: 'prod-3', count: 1 }] })] }))
    const slot = screen.getAllByTestId('beacon-module-slot')[0]
    expect(slot).toHaveAttribute('data-misfit', 'recipe')
    expect(slot.getAttribute('data-tip')).toContain('Prod 3 cannot be used for')
    expect(screen.getByTestId('module-not-allowed')).toHaveTextContent('cannot be used for')
  })

  it('gives no verdict for a beacon without a resolvable entity', () => {
    const gd = makeGameData()
    gd.recipes['iron-plate'].allowProductivity = false
    renderBeacons(gd, rowNode({ beaconConfigs: [beacon({ beaconId: undefined, modules: [{ moduleId: 'prod-3', count: 1 }] })] }))
    expect(screen.getAllByTestId('beacon-module-slot')[0]).not.toHaveAttribute('data-misfit')
    expect(screen.queryByTestId('module-not-allowed')).toBeNull()
  })

  it('rejects a module by category: options omit it and a stored one is noted', () => {
    const gd = makeGameData()
    gd.beacons.beacon.allowedModuleCategories = ['speed']
    renderBeacons(gd, rowNode({ beaconConfigs: [beacon({ modules: [{ moduleId: 'eff-1', count: 1 }] })] }))
    expect(screen.getByTestId('module-not-allowed')).toHaveTextContent('Ringed modules cannot be inserted in Beacon')
    expect(screen.getAllByTestId('beacon-module-slot')[0]).toHaveAttribute('data-misfit', 'category')
    fireEvent.click(screen.getAllByTestId('beacon-module-slot')[1])
    expect(screen.getAllByTestId('beacon-module-option').map(e => e.getAttribute('data-module-id'))).toEqual(['speed-3'])
  })

  it('rings only the modules the beacon cannot take', () => {
    const gd = makeGameData()
    gd.recipes['iron-plate'].allowProductivity = true
    renderBeacons(gd, rowNode({ beaconConfigs: [beacon({ modules: [{ moduleId: 'prod-3', count: 1 }, { moduleId: 'speed-3', count: 1 }] })] }))
    const note = screen.getByTestId('module-not-allowed')
    expect(note).toHaveTextContent('Ringed modules cannot be inserted in Beacon')
    const slots = screen.getAllByTestId('beacon-module-slot')
    expect(slots[0]).toHaveAttribute('data-misfit')
    expect(slots[1], 'Speed 3 slot not ringed').not.toHaveAttribute('data-misfit')
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
    expectTip(add, 'No machine within research horizon')
  })

  it('disables adding when no beacon is within the horizon', () => {
    setRows(rowNode())
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    render(<BeaconsSection node={rowNode()} configs={[]} gameData={makeGameData()} onChange={() => {}} />)
    expectTip(screen.getByTestId('add-beacon-config'), 'No beacon within the research horizon')
  })

  it('disables adding when no module is within the horizon', () => {
    const gd = makeGameData()
    gd.technologies.base.unlockedRecipes = ['iron-plate', 'r-am1', 'r-beacon']
    gd.technologies.mods.unlockedRecipes = ['r-speed', 'r-prod']
    setRows(rowNode())
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    render(<BeaconsSection node={rowNode()} configs={[]} gameData={gd} onChange={() => {}} />)
    expectTip(screen.getByTestId('add-beacon-config'), 'No module within the research horizon')
  })
})

describe('BeaconsSection — apply to every row of the recipe', () => {
  it('copies every beacon configuration to the other rows of the recipe', () => {
    const configs = [beacon(), beacon({ beaconCount: 7 })]
    const first = rowNode({ beaconConfigs: configs })
    setRows(first, rowNode({ id: 'n2' }))
    render(<BeaconsSection node={first} configs={configs} gameData={makeGameData()} onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply to every row of this recipe (2)' }))
    expect(nodes().find(r => r.id === 'n2')!.beaconConfigs).toEqual(configs)
  })

  it('has no such button with a single row', () => {
    renderBeacons(makeGameData())
    expect(screen.queryByRole('button', { name: /Apply to every row/ })).not.toBeInTheDocument()
  })
})

describe('EffectsSection', () => {
  const renderEffects = (gd: GameData, node: GameRecipeNode) =>
    render(<EffectsSection node={node} beacons={node.beaconConfigs ?? []} gameData={gd} />)

  it('lists speed, productivity and energy with the machine, beacon and total columns', () => {
    const gd = makeGameData()
    renderEffects(gd, rowNode({ machineId: 'am1', beaconConfigs: [beacon()] }))
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['', 'Machine', 'Beacons', 'Total'])
    // 0.5 speed × 1.5 efficiency × 2 modules × 4 beacons
    expect(screen.getByTestId('effect-total-speed')).toHaveTextContent('+600%')
    expect(screen.getByText('Beacon effect = for each module, its effect × efficiency × its count × beacons, added up. All sources add up.', { exact: false })).toBeInTheDocument()
  })

  it('shows one Beacons column per configuration', () => {
    const gd = makeGameData()
    renderEffects(gd, rowNode({ machineId: 'am1', beaconConfigs: [beacon(), beacon({ beaconCount: 2 })] }))
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['', 'Machine', 'Beacons 1', 'Beacons 2', 'Total'])
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
    renderEffects(gd, rowNode({ machineId: 'am1', beaconConfigs: [beacon({ modules: [{ moduleId: 'prod-3', count: 2 }] })] }))
    expect(screen.getByTestId('recipe-effects-note')).toHaveTextContent('productivity of the beacons')
    const ignored = document.querySelector<HTMLElement>('[role="cell"][data-ignored="true"]')!
    expect(ignored).toHaveAccessibleDescription(/does not apply to this row/)
    expect(ignored).toHaveAccessibleDescription(/^Beacons\n\S+ does not apply to this row, because the recipe, machine or beacon does not allow it\.$/)
    expect(ignored).not.toHaveAttribute('title')
    expect(screen.getByTestId('effect-total-productivity')).toHaveTextContent('–')
  })

  it('counts the beacon effects with no machine in the horizon, limited by the beacon entity only', () => {
    const gd = makeGameData()
    gd.technologies.base.unlockedRecipes = ['iron-plate']
    gd.technologies.mods.unlockedRecipes = ['r-am1', 'r-beacon', 'r-speed']
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    renderEffects(gd, rowNode({ beaconConfigs: [beacon()] }))
    expect(screen.getByTestId('effect-total-speed')).toHaveTextContent('+600%')
  })
})

describe('BeaconsSection — switching the beacon type', () => {
  function switchTo(slots: number, config: BeaconConfig) {
    const gd = makeGameData()
    gd.beacons.other = { ...gd.beacons.beacon, id: 'other', name: 'Other', moduleSlots: slots }
    renderBeacons(gd, rowNode({ beaconConfigs: [config] }))
    fireEvent.click(screen.getByTestId('beacon-type-button'))
    fireEvent.click(screen.getAllByTestId('beacon-option').find(e => e.getAttribute('data-beacon-id') === 'other')!)
    return storedBeacon()
  }

  it('trims a full beacon to the slots of a smaller type', () => {
    expect(switchTo(1, beacon())).toMatchObject({ beaconId: 'other', modulesPerBeacon: 1, modules: [{ moduleId: 'speed-3', count: 1 }] })
  })

  it('refills every slot of a larger type when one module filled the old ones', () => {
    expect(switchTo(4, beacon())?.modules).toEqual([{ moduleId: 'speed-3', count: 4 }])
  })

  it('keeps mixed modules and trims their overflow from the end', () => {
    const mixed = beacon({ modules: [{ moduleId: 'speed-3', count: 1 }, { moduleId: 'eff-1', count: 1 }] })
    expect(switchTo(1, mixed)?.modules).toEqual([{ moduleId: 'speed-3', count: 1 }])
  })

  it('keeps mixed modules when the slots grow', () => {
    const mixed = beacon({ modules: [{ moduleId: 'speed-3', count: 1 }, { moduleId: 'eff-1', count: 1 }] })
    expect(switchTo(4, mixed)?.modules).toEqual([{ moduleId: 'speed-3', count: 1 }, { moduleId: 'eff-1', count: 1 }])
  })

  it('fitModules leaves a partly filled beacon as it is when the slots grow', () => {
    expect(fitModules([{ moduleId: 'speed-3', count: 1 }], 2, 4)).toEqual([{ moduleId: 'speed-3', count: 1 }])
    expect(fitModules([{ moduleId: 'speed-3', count: 2 }], 2, 0)).toEqual([])
  })
})
