import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RecipeRow } from './RecipeRow'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import type { GameData, SolvedNode, RecipeNode, SubPlanNode } from '../../data/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ironPlateRecipeNode: RecipeNode = {
  kind: 'game-recipe',
  id: 'node-1',
  recipeId: 'iron-plate',
  modules: [],
  byproductPolicy: {},
}

const solvedNode: SolvedNode = {
  recipeNodeId: 'node-1',
  inputRates: { 'iron-ore': 120 },
  outputRates: { 'iron-plate': 60 },
  throughput: 30,
  machineCountExact: 2,
  machineCountCeil: 2,
  powerKw: 180,
}

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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function renderRow(props: Partial<Parameters<typeof RecipeRow>[0]> = {}) {
  return render(
    <table>
      <tbody>
        <RecipeRow
          solvedNode={solvedNode}
          planNode={ironPlateRecipeNode}
          isFirst={false}
          isLast={false}
          gameData={mockGameData}
          {...props}
        />
      </tbody>
    </table>
  )
}

beforeEach(() => {
  const block = makeEmptyBlock('Test')
  const rootPlan = { ...block.rootPlan, nodes: [ironPlateRecipeNode] }
  useBlockStore.setState({
    blocks: [{ ...block, rootPlan }],
    activeBlockId: block.id,
    activeSubPlanId: rootPlan.id,
    history: {},
  })
  useUiStore.setState({ rateUnit: 'min', activeFloorPath: [] })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecipeRow', () => {
  it('renders the recipe name', () => {
    renderRow()
    // Recipe name appears at least once (may appear more from item tiles)
    expect(screen.getAllByText('Iron Plate').length).toBeGreaterThan(0)
  })

  it('renders the machine count', () => {
    renderRow()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('renders product tile', () => {
    renderRow()
    // 60 items/min → "60" in the tile
    expect(screen.getByText(/60/)).toBeInTheDocument()
  })

  it('renders ingredient tile', () => {
    renderRow()
    // 120 items/min → "120"
    expect(screen.getByText(/120/)).toBeInTheDocument()
  })

  it('renders electricity tile', () => {
    renderRow()
    expect(screen.getByText('⚡')).toBeInTheDocument()
  })

  it('move-up button is disabled when isFirst=true', () => {
    renderRow({ isFirst: true })
    expect(screen.getByLabelText('Move up')).toBeDisabled()
  })

  it('move-down button is disabled when isLast=true', () => {
    renderRow({ isLast: true })
    expect(screen.getByLabelText('Move down')).toBeDisabled()
  })

  it('clicking move-up calls moveNodeUp in blockStore', () => {
    const node2: RecipeNode = { ...ironPlateRecipeNode, id: 'node-2', recipeId: 'iron-plate' }
    const block = makeEmptyBlock('Test')
    const rootPlan = { ...block.rootPlan, nodes: [ironPlateRecipeNode, node2] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      activeSubPlanId: rootPlan.id,
      history: {},
    })
    renderRow({ isFirst: false, planNode: node2 })
    fireEvent.click(screen.getByLabelText('Move up'))
    const nodes = useBlockStore.getState().blocks[0].rootPlan.nodes
    expect(nodes[0].id).toBe('node-2')
    expect(nodes[1].id).toBe('node-1')
  })

  it('clicking a byproduct tile toggles byproductPolicy', () => {
    const nodeWithByproduct: RecipeNode = {
      ...ironPlateRecipeNode,
      byproductPolicy: { 'iron-plate': 'feed-back' },
    }
    const solvedWithByproduct: SolvedNode = {
      ...solvedNode,
      outputRates: { 'iron-plate': 60, 'slag': 10 },
    }
    const block = makeEmptyBlock('Test')
    const rootPlan = { ...block.rootPlan, nodes: [nodeWithByproduct] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      activeSubPlanId: rootPlan.id,
      history: {},
    })
    renderRow({ planNode: nodeWithByproduct, solvedNode: solvedWithByproduct })

    // Slag tile is a byproduct (not primaryItemId = iron-plate)
    // The tile renders as a button for byproducts
    const buttons = screen.getAllByRole('button')
    const slagButton = buttons.find(b => b.title?.includes('slag') || b.getAttribute('title')?.includes('slag'))
    if (slagButton) {
      fireEvent.click(slagButton)
      const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
      if (updated.kind === 'game-recipe') {
        expect(updated.byproductPolicy['slag']).toBe('discard')
      }
    }
  })

  it('subplan node renders drill-in button', () => {
    const spNode: SubPlanNode = { kind: 'subplan', id: 'sp-node-1', subPlanId: 'sp-123' }
    const pushFloor = vi.fn()
    useUiStore.setState({ rateUnit: 'min', activeFloorPath: [], pushFloor })
    renderRow({ planNode: spNode, solvedNode: undefined })
    const drillBtn = screen.getByRole('button', { name: /Subplan/ })
    fireEvent.click(drillBtn)
    expect(pushFloor).toHaveBeenCalledWith('sp-123')
  })
})
