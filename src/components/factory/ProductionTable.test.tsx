import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { ProductionTable } from './ProductionTable'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { GameData, RecipeNode, SubPlanNode } from '../../data/types'

const mockGameData: GameData = {
  factorioVersion: '2.0.0',
  modSet: {},
  items: {
    'iron-plate': { id: 'iron-plate', name: 'Iron Plate', type: 'item', iconPath: '', hidden: false },
    'iron-ore': { id: 'iron-ore', name: 'Iron Ore', type: 'item', iconPath: '', hidden: false },
  },
  recipes: {
    'iron-plate': {
      id: 'iron-plate',
      name: 'Iron Plate',
      category: 'smelting',
      craftingTime: 3.2,
      ingredients: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
      products: [{ itemId: 'iron-plate', type: 'item', amount: 1 }],
      madeIn: ['electric-furnace'],
      allowProductivity: true,
      hidden: false,
      mainProduct: 'iron-plate',
    },
  },
  machines: {
    'electric-furnace': {
      id: 'electric-furnace',
      name: 'Electric Furnace',
      craftingCategories: ['smelting'],
      craftingSpeed: 2,
      energyUsage: 180,
      drain: 6,
      moduleSlots: 2,
      allowedEffects: ['speed', 'productivity', 'consumption'],
      hidden: false,
    },
  },
  modules: {},
  defaultMachines: { smelting: 'electric-furnace' },
  beacons: {},
  technologies: {},
  startingRecipes: [],
} as unknown as GameData

const existingNode: RecipeNode = {
  kind: 'game-recipe',
  id: 'node-1',
  recipeId: 'iron-plate',
  modules: [],
  byproductPolicy: {},
}

beforeEach(() => {
  const block = makeEmptyBlock('Test')
  useBlockStore.setState({
    blocks: [block],
    activeBlockId: block.id,
    history: {},
  })
  useUiStore.setState({ rateUnit: 'min', revealRowRequest: null })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: mockGameData, sourceId: 'test' } })
  useSolverStore.setState({ status: { type: 'idle' }, lastResult: undefined, _setStatus: () => {} })
})

describe('ProductionTable', () => {
  it('shows empty state when no nodes', () => {
    render(<ProductionTable />)
    expect(screen.getByText('No recipes yet')).toBeInTheDocument()
  })

  it('shows recipe rows when nodes exist', () => {
    const block = useBlockStore.getState().blocks[0]
    const rootPlan = { ...block.rootPlan, nodes: [existingNode] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      history: {},
    })
    render(<ProductionTable />)
    // Recipe icon/placeholder has the recipe name in its title attribute
    expect(screen.getByTitle('Iron Plate')).toBeInTheDocument()
  })

  it('clicking add-recipe in empty state shows recipe picker', async () => {
    render(<ProductionTable />)
    fireEvent.click(screen.getByText('+ Add recipe'))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Add recipe' })).toBeInTheDocument()
    })
  })

  it('shows an Add recipe button in the header instead of a footer when nodes exist', async () => {
    const block = useBlockStore.getState().blocks[0]
    const rootPlan = { ...block.rootPlan, nodes: [existingNode] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      history: {},
    })
    render(<ProductionTable />)
    expect(screen.queryByText('+ Add recipe')).not.toBeInTheDocument()
    const header = screen.getAllByRole('columnheader')[0]
    const button = within(header).getByRole('button', { name: 'Add recipe' })
    fireEvent.click(button)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Add recipe' })).toBeInTheDocument()
    })
  })

  it('adding a recipe via picker creates a node in blockStore', async () => {
    render(<ProductionTable />)
    fireEvent.click(screen.getByText('+ Add recipe'))
    await waitFor(() => screen.getByRole('heading', { name: 'Add recipe' }))

    // Click the Iron Plate recipe slot in the picker
    const recipeButton = screen.getByTitle('Iron Plate')
    fireEvent.click(recipeButton)

    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes).toHaveLength(1)
    if (nodes[0].kind === 'game-recipe') {
      expect(nodes[0].recipeId).toBe('iron-plate')
    }
  })

  it('clicking an ingredient opens the picker filtered to that item', async () => {
    // Seed a row, and a solver result so the row has an ingredient tile.
    const block = useBlockStore.getState().blocks[0]
    const rootPlan = { ...block.rootPlan, nodes: [existingNode] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      history: {},
    })
    useSolverStore.setState({
      status: { type: 'success' },
      lastResult: {
        nodes: [{
          recipeNodeId: 'node-1',
          inputRates: { 'iron-ore': 60 },
          outputRates: { 'iron-plate': 60 },
          throughput: 30,
          machineCountExact: 1,
          machineCountCeil: 1,
          powerKw: 0,
        }],
      },
      _setStatus: () => {},
    } as never)

    render(<ProductionTable />)
    const ingredient = screen.getByTitle('Iron Ore — Find producer recipe')
    fireEvent.click(ingredient)

    await waitFor(() => screen.getByRole('heading', { name: 'Add recipe' }))
    // Subtitle reflects the targeted item.
    expect(screen.getByText("Choose a recipe to produce 'Iron Ore'")).toBeInTheDocument()
  })

  describe('byproduct right-click', () => {
    // Fresh data per call: adds a slag byproduct and a recipe that consumes it.
    function slagData(): GameData {
      const data = structuredClone(mockGameData)
      data.items['slag'] = { id: 'slag', name: 'Slag', type: 'item', iconPath: '', hidden: false } as GameData['items'][string]
      data.recipes['slag-to-plate'] = {
        ...structuredClone(data.recipes['iron-plate']),
        id: 'slag-to-plate',
        name: 'Slag To Plate',
        ingredients: [{ itemId: 'slag', type: 'item', amount: 2 }],
      }
      return data
    }

    function solveWithSlag(nodeId: string) {
      useSolverStore.setState({
        status: { type: 'success' },
        lastResult: {
          nodes: [{
            recipeNodeId: nodeId,
            inputRates: { 'iron-ore': 60 },
            outputRates: { 'iron-plate': 60, slag: 10 },
            throughput: 30,
            machineCountExact: 1,
            machineCountCeil: 1,
            powerKw: 0,
          }],
        },
        _setStatus: () => {},
      } as never)
    }

    beforeEach(() => {
      useGameDataStore.setState({ status: { type: 'loaded', gameData: slagData(), sourceId: 'test' } })
    })

    async function openConsumerPicker() {
      fireEvent.contextMenu(screen.getByTitle(/^Slag — /))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Add consumer recipe…' }))
      await waitFor(() => screen.getByRole('heading', { name: 'Add recipe' }))
      expect(screen.getByText("Choose a recipe that consumes 'Slag'")).toBeInTheDocument()
    }

    it('adds the chosen consumer recipe to the root plan', async () => {
      const block = useBlockStore.getState().blocks[0]
      useBlockStore.setState({
        blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [structuredClone(existingNode)] } }],
        activeBlockId: block.id,
        history: {},
      })
      solveWithSlag('node-1')
      render(<ProductionTable />)
      await openConsumerPicker()

      fireEvent.click(screen.getByTitle('Slag To Plate'))
      const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
      expect(nodes).toHaveLength(2)
      expect(nodes[1].kind === 'game-recipe' && nodes[1].recipeId).toBe('slag-to-plate')
    })

    it('adds the consumer to the sub-plan of the row it was opened from', async () => {
      const block = useBlockStore.getState().blocks[0]
      const sub = { ...makeEmptyBlock('x').rootPlan, id: 'sp-1', name: 'Sub', nodes: [structuredClone(existingNode)] }
      const subNode: SubPlanNode = { kind: 'subplan', id: 'sp-node', subPlanId: 'sp-1' } as SubPlanNode
      useBlockStore.setState({
        blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [subNode], subPlans: [sub] } }],
        activeBlockId: block.id,
        history: {},
      })
      solveWithSlag('node-1')
      render(<ProductionTable />)
      // Expand the sub-factory so its row renders.
      fireEvent.click(screen.getByText('▶'))
      await openConsumerPicker()

      fireEvent.click(screen.getByTitle('Slag To Plate'))
      const root = useBlockStore.getState().blocks[0].rootPlan
      expect(root.nodes).toHaveLength(1)
      expect(root.subPlans[0].nodes).toHaveLength(2)
    })
  })
})

describe('ProductionTable — revealing a row', () => {
  const original = Element.prototype.scrollIntoView
  const scrollIntoView = vi.fn()

  /** Root with a row and a collapsed area P holding the row `p-1`. */
  function loadAreaBlock() {
    const block = useBlockStore.getState().blocks[0]
    const area = {
      ...makeEmptyBlock('P').rootPlan,
      id: 'P',
      name: 'Plastics',
      area: true,
      nodes: [{ ...existingNode, id: 'p-1' }],
    }
    const handle: SubPlanNode = { kind: 'subplan', id: 'h-p', subPlanId: 'P' }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [existingNode, handle], subPlans: [area] } }],
      activeBlockId: block.id,
      history: {},
    })
  }
  const rowEl = (id: string) => document.querySelector(`tr[data-node-id="${id}"]`)

  beforeEach(() => {
    vi.useFakeTimers()
    scrollIntoView.mockClear()
    Element.prototype.scrollIntoView = scrollIntoView
  })

  afterEach(() => {
    vi.useRealTimers()
    Element.prototype.scrollIntoView = original
  })

  it('expands the sub-factory, scrolls to the row and highlights it for two seconds', () => {
    loadAreaBlock()
    render(<ProductionTable />)
    expect(rowEl('p-1')).toBeNull()

    act(() => useUiStore.getState().requestRevealRow('p-1'))
    expect(rowEl('p-1')).toHaveAttribute('data-highlighted', 'true')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(2000) })
    expect(rowEl('p-1')).not.toHaveAttribute('data-highlighted')
  })

  it('ignores a request for a row that is not in the block', () => {
    loadAreaBlock()
    render(<ProductionTable />)
    act(() => useUiStore.getState().requestRevealRow('nope'))
    expect(rowEl('p-1')).toBeNull()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('ignores a request made before the table mounted', () => {
    loadAreaBlock()
    useUiStore.getState().requestRevealRow('p-1')
    render(<ProductionTable />)
    expect(rowEl('p-1')).toBeNull()
  })
})

describe('ProductionTable — by-recipe view', () => {
  const original = Element.prototype.scrollIntoView

  const solvedNode = (id: string, ceil: number) => ({
    recipeNodeId: id, inputRates: { 'iron-ore': 60 }, outputRates: { 'iron-plate': 60 },
    throughput: 1, machineCountExact: ceil - 0.5, machineCountCeil: ceil, powerKw: 0,
  })

  /** Block `id` with a root row `node-1` and an area "Plastics" (handle `h-p`) holding `p-1`, the same recipe. */
  function areaBlock(id: string, areas = true) {
    const block = { ...makeEmptyBlock(`Block ${id}`), id }
    const plastics = { ...makeEmptyBlock('P').rootPlan, id: `P-${id}`, name: 'Plastics', area: areas, nodes: [{ ...existingNode, id: `p-1${id}` }] }
    const handle: SubPlanNode = { kind: 'subplan', id: `h-p${id}`, subPlanId: plastics.id }
    return {
      ...block,
      rootPlan: { ...block.rootPlan, nodes: [{ ...existingNode, id: `node-1${id}` }, handle], subPlans: [plastics] },
    }
  }
  const load = (blocks: ReturnType<typeof areaBlock>[], active = blocks[0].id) => {
    useBlockStore.setState({ blocks, activeBlockId: active, history: {} })
    useSolverStore.setState({
      lastResults: Object.fromEntries(blocks.map(b => [b.id, {
        nodes: [solvedNode(`node-1${b.id}`, 2), solvedNode(`p-1${b.id}`, 1)], unsatisfied: [], warnings: [],
      }])),
    })
  }
  const rowEl = (id: string) => document.querySelector(`tr[data-node-id="${id}"]`)
  const toggle = () => screen.queryByRole('button', { name: 'By recipe' })

  beforeEach(() => {
    useUiStore.setState({ tableView: 'tree', revealRowRequest: null })
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    Element.prototype.scrollIntoView = original
  })

  it('has no toggle in a block without areas, and shows the tree there even if recipe view is stored', () => {
    load([areaBlock('A', false)])
    useUiStore.setState({ tableView: 'recipe' })
    render(<ProductionTable />)
    expect(toggle()).not.toBeInTheDocument()
    expect(screen.queryByTestId('recipe-group')).not.toBeInTheDocument()
    expect(rowEl('node-1A')).toBeInTheDocument()
  })

  it('toggles the view in a block with areas', () => {
    load([areaBlock('A')])
    render(<ProductionTable />)
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle()!)
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(useUiStore.getState().tableView).toBe('recipe')
  })

  it('shows one line per recipe with the total, and the rows per area when opened', () => {
    load([areaBlock('A')])
    useUiStore.setState({ tableView: 'recipe' })
    render(<ProductionTable />)
    expect(screen.getByTestId('recipe-group-buildings').textContent).toBe('3 buildings')
    expect(screen.queryByTitle('Plastics')).not.toBeInTheDocument() // the area's handle row is not in this view
    expect(rowEl('node-1A')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Iron Plate: rows per area' }))
    expect(screen.getAllByTestId('row-area').map(e => e.textContent)).toEqual(['Top level', 'Plastics'])
    expect(screen.queryByLabelText('Move up')).not.toBeInTheDocument()
    expect(rowEl('node-1A')).toHaveAttribute('draggable', 'false')
  })

  it('opens the line of a revealed row and highlights the row', () => {
    load([areaBlock('A')])
    useUiStore.setState({ tableView: 'recipe' })
    render(<ProductionTable />)
    act(() => useUiStore.getState().requestRevealRow('p-1A'))
    expect(rowEl('p-1A')).toHaveAttribute('data-highlighted', 'true')
    expect(screen.getAllByTestId('row-area')).toHaveLength(2)
  })

  it('closes the lines again after another block was active', () => {
    load([areaBlock('A'), areaBlock('B')])
    useUiStore.setState({ tableView: 'recipe' })
    render(<ProductionTable />)
    fireEvent.click(screen.getByRole('button', { name: 'Iron Plate: rows per area' }))
    expect(screen.getAllByTestId('row-area')).toHaveLength(2)
    act(() => useBlockStore.getState().setActiveBlock('B'))
    expect(screen.queryByTestId('row-area')).not.toBeInTheDocument()
    act(() => useBlockStore.getState().setActiveBlock('A'))
    expect(screen.queryByTestId('row-area')).not.toBeInTheDocument()
  })

  it('ignores a reveal request for a handle', () => {
    load([areaBlock('A')])
    useUiStore.setState({ tableView: 'recipe' })
    render(<ProductionTable />)
    act(() => useUiStore.getState().requestRevealRow('h-pA'))
    expect(document.querySelector('[data-highlighted]')).toBeNull()
    expect(screen.queryByTestId('row-area')).not.toBeInTheDocument()
  })

  it('reveals a row of another block after switching to it in the same update', () => {
    load([areaBlock('A'), areaBlock('B')])
    render(<ProductionTable />)
    act(() => {
      useBlockStore.getState().setActiveBlock('B')
      useUiStore.getState().requestRevealRow('h-pB')
    })
    expect(rowEl('h-pB')).toHaveAttribute('data-highlighted', 'true')
  })
})

describe('ProductionTable — recipe picker', () => {
  it('disables a recipe the block already has', () => {
    const block = useBlockStore.getState().blocks[0]
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [existingNode] } }],
      activeBlockId: block.id,
      history: {},
    })
    render(<ProductionTable />)
    fireEvent.click(within(screen.getAllByRole('columnheader')[0]).getByRole('button', { name: 'Add recipe' }))
    const slot = screen.getAllByTestId('recipe-slot').find(e => e.getAttribute('data-recipe-id') === 'iron-plate')!
    expect(slot).toBeDisabled()
    expect(slot).toHaveAttribute('title', 'Iron Plate (already in this block)')
  })
})
