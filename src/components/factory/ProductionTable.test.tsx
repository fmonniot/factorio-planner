import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProductionTable } from './ProductionTable'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { GameData, RecipeNode } from '../../data/types'

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
  useUiStore.setState({ rateUnit: 'min' })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: mockGameData } })
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
})
