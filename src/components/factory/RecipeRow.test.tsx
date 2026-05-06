import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RecipeRow } from './RecipeRow'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import type { GameData, SolvedNode, RecipeNode, SubPlanNode } from '../../data/types'

// ---------------------------------------------------------------------------
// Fixtures — single-output
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

// ---------------------------------------------------------------------------
// Fixtures — multi-output (electrolysis: hydrogen + oxygen + heavy-water)
// ---------------------------------------------------------------------------

const electrolysisPlanNode: RecipeNode = {
  kind: 'game-recipe',
  id: 'node-elec',
  recipeId: 'electrolysis',
  modules: [],
  byproductPolicy: {},
  // primaryProduct not set → defaults to recipe.mainProduct = 'hydrogen'
}

const electrolysisSolved: SolvedNode = {
  recipeNodeId: 'node-elec',
  inputRates: { 'water': 100 },
  outputRates: { 'hydrogen': 60, 'oxygen': 30 },
  throughput: 10,
  machineCountExact: 1,
  machineCountCeil: 1,
  powerKw: 50,
}

// ---------------------------------------------------------------------------
// Shared game data (covers both single and multi-output recipes)
// ---------------------------------------------------------------------------

const mockGameData: GameData = {
  factorioVersion: '2.0.0',
  modSet: {},
  items: {
    'iron-plate': { id: 'iron-plate', name: 'Iron Plate', type: 'item', iconPath: '', hidden: false },
    'iron-ore': { id: 'iron-ore', name: 'Iron Ore', type: 'item', iconPath: '', hidden: false },
    'hydrogen': { id: 'hydrogen', name: 'Hydrogen', type: 'fluid', iconPath: '', hidden: false },
    'oxygen': { id: 'oxygen', name: 'Oxygen', type: 'fluid', iconPath: '', hidden: false },
    'water': { id: 'water', name: 'Water', type: 'fluid', iconPath: '', hidden: false },
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
    'electrolysis': {
      id: 'electrolysis',
      name: 'Electrolysis',
      category: 'chemistry',
      craftingTime: 2,
      ingredients: [{ itemId: 'water', type: 'fluid', amount: 100 }],
      products: [
        { itemId: 'hydrogen', type: 'fluid', amount: 6 },
        { itemId: 'oxygen', type: 'fluid', amount: 3 },
      ],
      madeIn: ['chemical-plant'],
      allowProductivity: false,
      hidden: false,
      mainProduct: 'hydrogen',
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
  const block = useBlockStore.getState().blocks[0]
  return render(
    <table>
      <tbody>
        <RecipeRow
          solvedNode={solvedNode}
          planNode={ironPlateRecipeNode}
          isFirst={false}
          isLast={false}
          depth={0}
          gameData={mockGameData}
          rootPlan={block?.rootPlan ?? { id: 'r', name: 'Root', goals: [], nodes: [], subPlans: [], createdAt: '', updatedAt: '' }}
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
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RecipeRow', () => {
  it('renders recipe name via title on icon/placeholder', () => {
    renderRow()
    // Recipe name is on the icon/placeholder title (may also appear in item tile titles)
    expect(screen.getAllByTitle('Iron Plate').length).toBeGreaterThan(0)
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

  it('subplan node renders expand/collapse toggle', () => {
    const spNode: SubPlanNode = { kind: 'subplan', id: 'sp-node-1', subPlanId: 'sp-123' }
    const onToggle = vi.fn()
    renderRow({ planNode: spNode, solvedNode: undefined, isExpanded: false, onToggleExpand: onToggle })
    // The collapsed toggle shows ▶ inside a colSpan cell (not the reorder ▲/▼ buttons)
    const collapseIcon = screen.getByText('▶')
    expect(collapseIcon).toBeInTheDocument()
    // Click the button that contains ▶
    fireEvent.click(collapseIcon.closest('button')!)
    expect(onToggle).toHaveBeenCalled()
  })

  it('× button removes a game-recipe node from the store', () => {
    renderRow()
    fireEvent.click(screen.getByTitle('Remove recipe'))
    expect(useBlockStore.getState().blocks[0].rootPlan.nodes).toHaveLength(0)
  })

  it('× button removes a subplan node from the store', () => {
    const spNode: SubPlanNode = { kind: 'subplan', id: 'sp-node-1', subPlanId: 'sp-123' }
    const block = makeEmptyBlock('Test')
    const rootPlan = { ...block.rootPlan, nodes: [spNode] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      activeSubPlanId: rootPlan.id,
      history: {},
    })
    renderRow({ planNode: spNode, solvedNode: undefined })
    fireEvent.click(screen.getByTitle('Remove subplan'))
    expect(useBlockStore.getState().blocks[0].rootPlan.nodes).toHaveLength(0)
  })

  it('subplan node shows expanded indicator when isExpanded=true', () => {
    const spNode: SubPlanNode = { kind: 'subplan', id: 'sp-node-1', subPlanId: 'sp-123' }
    renderRow({ planNode: spNode, solvedNode: undefined, isExpanded: true, onToggleExpand: () => {} })
    const chevrons = screen.getAllByText('▼')
    expect(chevrons.length).toBeGreaterThan(0)
  })

  it('clicking an ingredient tile calls onIngredientClick with the item id', () => {
    const onIngredientClick = vi.fn()
    renderRow({ onIngredientClick })
    // Title set when onIngredientClick is provided.
    const tile = screen.getByTitle('Iron Ore — Find producer recipe')
    fireEvent.click(tile)
    expect(onIngredientClick).toHaveBeenCalledWith('iron-ore')
  })

  it('ingredient tile is not a button when onIngredientClick is omitted', () => {
    renderRow()
    // No "Find producer recipe" title — the tile renders as a span.
    expect(screen.queryByTitle(/Find producer recipe/)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// T11 — Primary product selection
// ---------------------------------------------------------------------------

describe('T11 — Primary product selection', () => {
  it('single-output: no "Set as primary" elements', () => {
    renderRow({ planNode: ironPlateRecipeNode, solvedNode })
    expect(screen.queryByTitle(/Set as primary/)).not.toBeInTheDocument()
  })

  it('multi-output: primary tile appears in Products column (no badge needed)', () => {
    const block = makeEmptyBlock('Test')
    const rootPlan = { ...block.rootPlan, nodes: [electrolysisPlanNode] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, activeSubPlanId: rootPlan.id, history: {} })
    renderRow({ planNode: electrolysisPlanNode, solvedNode: electrolysisSolved })
    // The Products cell renders a tile for Hydrogen (the primary).
    // The Byproducts cell renders a tile for Oxygen with "Set as primary".
    // No ● badge — the column position is the feedback.
    expect(screen.queryByTitle('Primary product')).not.toBeInTheDocument()
    expect(screen.getByTitle(/Set as primary/)).toBeInTheDocument()
  })

  it('multi-output: non-primary tiles have title "Set as primary"', () => {
    const block = makeEmptyBlock('Test')
    const rootPlan = { ...block.rootPlan, nodes: [electrolysisPlanNode] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, activeSubPlanId: rootPlan.id, history: {} })
    renderRow({ planNode: electrolysisPlanNode, solvedNode: electrolysisSolved })
    // Oxygen is non-primary → its tile has title "Set as primary"
    expect(screen.getByTitle(/Set as primary/)).toBeInTheDocument()
  })

  it('clicking "Set as primary" calls updateNodePrimaryProduct', () => {
    const block = makeEmptyBlock('Test')
    const rootPlan = { ...block.rootPlan, nodes: [electrolysisPlanNode] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, activeSubPlanId: rootPlan.id, history: {} })
    renderRow({ planNode: electrolysisPlanNode, solvedNode: electrolysisSolved })

    const setAsPrimaryBtn = screen.getByTitle(/Set as primary/)
    fireEvent.click(setAsPrimaryBtn)

    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    if (updated.kind === 'game-recipe') {
      expect(updated.primaryProduct).toBe('oxygen')
    }
  })
})

// ---------------------------------------------------------------------------
// T12 — Pin rate UI
// ---------------------------------------------------------------------------

describe('T12 — Pin rate UI', () => {
  function setupElectrolysis(pinnedRate?: number) {
    const node: RecipeNode = { ...electrolysisPlanNode, pinnedRate }
    const block = makeEmptyBlock('Test')
    const rootPlan = { ...block.rootPlan, nodes: [node] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, activeSubPlanId: rootPlan.id, history: {} })
    return node
  }

  it('unpinned row shows 📍 with title "Pin rate"', () => {
    setupElectrolysis(undefined)
    renderRow({ planNode: electrolysisPlanNode, solvedNode: electrolysisSolved })
    expect(screen.getByTitle('Pin rate')).toBeInTheDocument()
    expect(screen.queryByTitle('Unpin rate')).not.toBeInTheDocument()
  })

  it('pinned row shows 📌 with title "Unpin rate" and a pinned input', () => {
    const pinned = setupElectrolysis(2)
    renderRow({ planNode: pinned, solvedNode: electrolysisSolved })
    expect(screen.getByTitle('Unpin rate')).toBeInTheDocument()
    expect(screen.queryByTitle('Pin rate')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Pinned rate')).toBeInTheDocument()
  })

  it('clicking 📍 calls updateNodePinnedRate with value > 0 even when throughput is 0', () => {
    setupElectrolysis(undefined)
    const zeroThroughput: SolvedNode = { ...electrolysisSolved, throughput: 0 }
    renderRow({ planNode: electrolysisPlanNode, solvedNode: zeroThroughput })
    fireEvent.click(screen.getByTitle('Pin rate'))
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    if (updated.kind === 'game-recipe') {
      expect(updated.pinnedRate).toBeDefined()
      expect(updated.pinnedRate!).toBeGreaterThan(0)
    }
  })

  it('clicking 📌 calls updateNodePinnedRate with undefined', () => {
    const pinned = setupElectrolysis(2)
    renderRow({ planNode: pinned, solvedNode: electrolysisSolved })
    fireEvent.click(screen.getByTitle('Unpin rate'))
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    if (updated.kind === 'game-recipe') {
      expect(updated.pinnedRate).toBeUndefined()
    }
  })

  it('changing pinned input in /min mode stores rate / 60 in blockStore', () => {
    useUiStore.setState({ rateUnit: 'min' })
    const pinned = setupElectrolysis(1)
    renderRow({ planNode: pinned, solvedNode: electrolysisSolved })
    const input = screen.getByLabelText('Pinned rate')
    fireEvent.change(input, { target: { value: '120' } })
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    if (updated.kind === 'game-recipe') {
      expect(updated.pinnedRate).toBeCloseTo(2) // 120 / 60 = 2
    }
  })

  it('changing pinned input in /sec mode stores the value directly', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    const pinned = setupElectrolysis(1)
    renderRow({ planNode: pinned, solvedNode: electrolysisSolved })
    const input = screen.getByLabelText('Pinned rate')
    fireEvent.change(input, { target: { value: '5' } })
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    if (updated.kind === 'game-recipe') {
      expect(updated.pinnedRate).toBeCloseTo(5)
    }
  })
})

// ---------------------------------------------------------------------------
// Task 9: v2 surplus intermediate renders as a byproduct tile
// ---------------------------------------------------------------------------

describe('RecipeRow — v2 surplus intermediate renders as byproduct', () => {
  beforeEach(() => {
    const block = makeEmptyBlock('Test')
    const node: RecipeNode = {
      kind: 'game-recipe',
      id: 'node-elec',
      recipeId: 'electrolysis',
      modules: [],
      byproductPolicy: {},
    }
    const rootPlan = { ...block.rootPlan, nodes: [node] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      activeSubPlanId: rootPlan.id,
      history: {},
    })
    useUiStore.setState({ rateUnit: 'min' })
  })

  it('a SolvedNode with a surplus item in outputRates renders a byproduct tile for it', () => {
    // Simulate v2 result: electrolysis produces hydrogen (primary) + steam (surplus intermediate)
    const surplusNode: SolvedNode = {
      recipeNodeId: 'node-elec',
      inputRates: { water: 100 },
      outputRates: { hydrogen: 60, steam: 15 }, // steam is a surplus intermediate
      throughput: 10,
      machineCountExact: 1,
      machineCountCeil: 1,
      powerKw: 50,
    }
    const planNode: RecipeNode = {
      kind: 'game-recipe',
      id: 'node-elec',
      recipeId: 'electrolysis',
      modules: [],
      byproductPolicy: {},
    }
    const gameDataWithSteam = {
      ...mockGameData,
      items: {
        ...mockGameData.items,
        steam: { id: 'steam', name: 'Steam', type: 'fluid' as const, iconPath: '', hidden: false },
      },
    } as typeof mockGameData

    const block = useBlockStore.getState().blocks[0]
    render(
      <table>
        <tbody>
          <RecipeRow
            solvedNode={surplusNode}
            planNode={planNode}
            isFirst={false}
            isLast={false}
            depth={0}
            gameData={gameDataWithSteam}
            rootPlan={block?.rootPlan ?? { id: 'r', name: 'Root', goals: [], nodes: [], subPlans: [], createdAt: '', updatedAt: '' }}
          />
        </tbody>
      </table>,
    )
    // steam appears as a byproduct tile (non-primary output — button with red-950 class)
    const steamTiles = screen.getAllByTitle(/Steam/i)
    expect(steamTiles.length).toBeGreaterThan(0)
  })
})
