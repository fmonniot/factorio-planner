import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { EditMachineModal } from './EditMachineModal'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useUiStore } from '../../store/uiStore'
import type { GameData } from '../../data/types'

function recipe(id: string, name: string): GameData['recipes'][string] {
  return {
    id, name, category: 'crafting', craftingTime: 1,
    ingredients: [], products: [{ itemId: 'plate', type: 'item', amount: 1 }],
    madeIn: ['assembler'], allowProductivity: false, hidden: false,
    mainProduct: undefined, subgroup: '', order: '',
  }
}

function item(id: string, placeResult?: string): GameData['items'][string] {
  return { id, name: id, type: 'item', iconPath: '', hidden: false, subgroup: '', order: '', placeResult }
}

function producer(id: string, product: string): GameData['recipes'][string] {
  return { ...recipe(id, id), products: [{ itemId: product, type: 'item', amount: 1 }] }
}

function machine(id: string, name: string, craftingSpeed: number): GameData['machines'][string] {
  return {
    id, name, type: 'assembling-machine', craftingSpeed, energyUsageKw: 75,
    energyType: 'electric', drainKw: 0, moduleSlots: 2, allowedEffects: ['speed'], craftingCategories: ['crafting'],
    iconPath: '', hidden: false,
  }
}

function makeGameData(): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {
      assembler: item('assembler', 'assembler'),
      'assembler-2': item('assembler-2', 'assembler-2'),
      speed: item('speed'),
    },
    recipes: {
      plate: recipe('plate', 'Plate'),
      'plate-alt': recipe('plate-alt', 'Plate (alternate)'),
      'r-asm1': producer('r-asm1', 'assembler'),
      'r-asm2': producer('r-asm2', 'assembler-2'),
      'r-speed': producer('r-speed', 'speed'),
    },
    machines: {
      assembler: machine('assembler', 'Assembler', 1),
      'assembler-2': machine('assembler-2', 'Assembler 2', 2),
    },
    modules: {
      speed: { id: 'speed', name: 'Speed', category: 'speed', tier: 1, effects: { speed: 0.2 }, limitation: [], limitationBlacklist: [], iconPath: '' },
    },
    beacons: {},
    defaultMachines: { crafting: 'assembler-2' },
    itemGroups: {},
    itemSubgroups: {},
    technologies: {
      base: { id: 'base', name: 'Base', prerequisites: [], unlockedRecipes: ['plate'], iconPath: '' },
      asm: { id: 'asm', name: 'Asm', prerequisites: [], unlockedRecipes: ['r-asm1'], iconPath: '' },
      alt: { id: 'alt', name: 'Alt', prerequisites: [], unlockedRecipes: ['plate-alt', 'r-asm2', 'r-speed'], iconPath: '' },
    },
    startingRecipes: [],
  }
}

function renderModal(
  gameData: GameData,
  props: Partial<React.ComponentProps<typeof EditMachineModal>> = {},
) {
  useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
  render(
    <EditMachineModal
      nodeId="n1"
      recipeId="plate"
      recipeCategory="crafting"
      machineId={undefined}
      machineCountCeil={1}
      modules={[]}
      gameData={gameData}
      onClose={() => {}}
      {...props}
    />,
  )
  fireEvent.click(screen.getByText(/machines$/))
}

const optionIds = () => screen.queryAllByTestId('machine-option').map(e => e.getAttribute('data-machine-id'))

beforeEach(() => {
  useBlockStore.setState({ horizonTechnologyIds: [], defaultMachineOverrides: {} })
  useUiStore.setState({ defaultMachinesRequest: null })
})

describe('EditMachineModal — alternate recipes and the research horizon', () => {
  it('omits an alternate recipe outside the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    renderModal(makeGameData())
    expect(screen.queryByText('Plate (alternate)')).not.toBeInTheDocument()
  })

  it('lists the alternate recipe when it is inside the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'alt'] })
    renderModal(makeGameData())
    expect(screen.getByText('Plate (alternate)')).toBeInTheDocument()
  })

  it('lists the alternate recipe without targets', () => {
    renderModal(makeGameData())
    expect(screen.getByText('Plate (alternate)')).toBeInTheDocument()
  })
})

describe('EditMachineModal — machines, modules and the research horizon', () => {
  it('lists only machines within the horizon and shows the horizon default', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'asm'] })
    renderModal(makeGameData())
    expect(optionIds()).toEqual(['assembler'])
    expect(screen.getByText('Assembler', { selector: 'span' })).toBeInTheDocument()
  })

  it('lists a later machine once its technology is in the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'asm', 'alt'] })
    renderModal(makeGameData())
    expect(optionIds()).toContain('assembler-2')
  })

  it('keeps an explicit machine beyond the horizon, flagged and not selectable', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'asm'] })
    renderModal(makeGameData(), { machineId: 'assembler-2' })
    expect(screen.getByText(/Assembler 2/)).toBeInTheDocument()
    expect(screen.getByTestId('beyond-horizon')).toBeInTheDocument()
    expect(optionIds()).not.toContain('assembler-2')
  })

  it('reports no machine within the horizon and an empty picker, keeping alternate recipes', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    const gd = makeGameData()
    gd.technologies.base.unlockedRecipes = ['plate', 'plate-alt']
    renderModal(gd)
    expect(screen.getByTestId('no-machine-in-horizon')).toBeVisible()
    expect(screen.getByTestId('machine-picker-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('machine-option')).not.toBeInTheDocument()
    expect(screen.getByText('Plate (alternate)')).toBeInTheDocument()
  })

  it('lets configured modules be removed but not added without a machine', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    const block = makeEmptyBlock('Test')
    useBlockStore.setState({
      blocks: [{
        ...block,
        rootPlan: {
          ...block.rootPlan,
          nodes: [{ kind: 'game-recipe', id: 'n1', recipeId: 'plate', modules: [{ moduleId: 'speed', count: 1 }], byproductPolicy: {} }],
        },
      }],
      activeBlockId: block.id,
      history: {},
    })
    renderModal(makeGameData(), { modules: [{ moduleId: 'speed', count: 1 }] })
    const moduleRow = screen.getByText('Speed').closest('div')!
    expect(within(moduleRow).getByTestId('beyond-horizon')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Remove one Speed'))
    const node = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(node.kind === 'game-recipe' && node.modules).toEqual([])
  })

  it('offers a module only once it is inside the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'asm'] })
    renderModal(makeGameData())
    expect(screen.queryByRole('option', { name: 'Speed' }), 'no speed option before its technology').not.toBeInTheDocument()
  })

  it('offers the module in the add dropdown within the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'asm', 'alt'] })
    renderModal(makeGameData())
    expect(screen.getByRole('option', { name: 'Speed' })).toBeInTheDocument()
  })
})

describe('EditMachineModal — default machine per category', () => {
  const nodeWith = (id: string, machineId?: string) => ({
    kind: 'game-recipe' as const, id, recipeId: 'plate', machineId, modules: [], byproductPolicy: {},
  })
  function setNodes(...nodes: ReturnType<typeof nodeWith>[]) {
    const block = makeEmptyBlock('Test')
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes } }],
      activeBlockId: block.id,
      history: {},
    })
  }
  const optionRow = (id: string) => screen.getAllByTestId('machine-option').find(e => e.getAttribute('data-machine-id') === id)!.parentElement!

  it('badges the horizon default machine and offers "Make default" on the others', () => {
    renderModal(makeGameData())
    expect(within(optionRow('assembler-2')).getByTestId('default-machine-badge')).toBeInTheDocument()
    expect(within(optionRow('assembler')).queryByTestId('default-machine-badge')).not.toBeInTheDocument()
    expect(within(optionRow('assembler')).getByRole('button', { name: 'Make Assembler the Crafting default' })).toBeInTheDocument()
  })

  it('labels the Default option with the effective machine', () => {
    renderModal(makeGameData())
    expect(screen.getByRole('button', { name: 'Default (Assembler 2)' })).toBeInTheDocument()
  })

  it('"Make default" sets the override, resets the row to Default and moves the badge', () => {
    setNodes(nodeWith('n1', 'assembler-2'))
    renderModal(makeGameData(), { machineId: 'assembler-2' })
    fireEvent.click(screen.getByRole('button', { name: 'Make Assembler the Crafting default' }))
    expect(useBlockStore.getState().defaultMachineOverrides).toEqual({ crafting: 'assembler' })
    const node = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(node.kind === 'game-recipe' && node.machineId).toBeUndefined()
    fireEvent.click(screen.getByText(/machines$/))
    expect(within(optionRow('assembler')).getByTestId('default-machine-badge')).toBeInTheDocument()
    expect(within(optionRow('assembler-2')).queryByTestId('default-machine-badge')).not.toBeInTheDocument()
  })

  it('reports how many rows follow the category default', () => {
    setNodes(nodeWith('n1'), nodeWith('n2'), nodeWith('n3', 'assembler'))
    renderModal(makeGameData())
    expect(screen.getByTestId('default-machine-usage')).toHaveTextContent('Crafting default is used by 2 rows')
  })

  it('"All defaults…" closes the modal and requests the default machines menu', () => {
    const onClose = vi.fn()
    renderModal(makeGameData(), { onClose })
    fireEvent.click(screen.getByRole('button', { name: 'All defaults…' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(useUiStore.getState().defaultMachinesRequest).toEqual({ seq: 1, category: 'crafting' })
  })
})
