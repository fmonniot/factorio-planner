import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { RecipeRow } from './RecipeRow'
import { RecipeDndProvider } from './RecipeDnd'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import type { GameData, SolvedNode, RecipeNode, GameRecipeNode, SubPlanNode } from '../../data/types'

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
  beacons: {},
  technologies: {},
  startingRecipes: [],
} as unknown as GameData

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function renderRow(props: Partial<Parameters<typeof RecipeRow>[0]> = {}) {
  const block = useBlockStore.getState().blocks[0]
  const rootPlan = block?.rootPlan ?? { id: 'r', name: 'Root', goals: [], nodes: [], subPlans: [], createdAt: '', updatedAt: '' }
  return render(
    <RecipeDndProvider>
      <table>
        <tbody>
          <RecipeRow
            solvedNode={solvedNode}
            planNode={ironPlateRecipeNode}
            isFirst={false}
            isLast={false}
            depth={0}
            gameData={mockGameData}
            rootPlan={rootPlan}
            parentSubPlanId={rootPlan.id}
            nodeIndex={0}
            {...props}
          />
        </tbody>
      </table>
    </RecipeDndProvider>
  )
}

beforeEach(() => {
  const block = makeEmptyBlock('Test')
  const rootPlan = { ...block.rootPlan, nodes: [ironPlateRecipeNode] }
  useBlockStore.setState({
    blocks: [{ ...block, rootPlan }],
    activeBlockId: block.id,
    history: {},
    horizonTechnologyIds: [],
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

  it('recipe cell has no inline action buttons (actions live in the right-click menu)', () => {
    renderRow()
    const cell = screen.getAllByTitle('Iron Plate')[0].closest('td')!
    expect(within(cell).queryAllByRole('button')).toHaveLength(0)
  })

  it('× button fully deletes the subplan from the tree (and its node reference)', () => {
    const childSubPlan = {
      id: 'sp-123',
      name: 'My Subfactory',
      goals: [],
      nodes: [],
      subPlans: [],
      noImportItems: [],
      createdAt: '',
      updatedAt: '',
    }
    const spNode: SubPlanNode = { kind: 'subplan', id: 'sp-node-1', subPlanId: 'sp-123' }
    const block = makeEmptyBlock('Test')
    const rootPlan = { ...block.rootPlan, nodes: [spNode], subPlans: [childSubPlan] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      history: {},
    })
    renderRow({ planNode: spNode, solvedNode: undefined })
    fireEvent.click(screen.getByTitle('Remove subplan'))
    const updatedRoot = useBlockStore.getState().blocks[0].rootPlan
    expect(updatedRoot.nodes).toHaveLength(0)
    expect(updatedRoot.subPlans).toHaveLength(0)
  })

  it('× button sits in the same <td> as the subplan name and is not hidden behind hover', () => {
    const childSubPlan = {
      id: 'sp-123',
      name: 'My Subfactory',
      goals: [],
      nodes: [],
      subPlans: [],
      noImportItems: [],
      createdAt: '',
      updatedAt: '',
    }
    const spNode: SubPlanNode = { kind: 'subplan', id: 'sp-node-1', subPlanId: 'sp-123' }
    const block = makeEmptyBlock('Test')
    const rootPlan = { ...block.rootPlan, nodes: [spNode], subPlans: [childSubPlan] }
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan }],
      activeBlockId: block.id,
      history: {},
    })
    renderRow({ planNode: spNode, solvedNode: undefined })
    const label = screen.getByText('My Subfactory')
    const button = screen.getByTitle('Remove subplan')
    // The visual-adjacency check: name and × live in the same cell.
    expect(label.closest('td')).toBe(button.closest('td'))
    // The discoverability check: × is not gated behind hover-only opacity.
    expect(button.className).not.toMatch(/opacity-0/)
  })

  it('subplan node shows expanded indicator when isExpanded=true', () => {
    const spNode: SubPlanNode = { kind: 'subplan', id: 'sp-node-1', subPlanId: 'sp-123' }
    renderRow({ planNode: spNode, solvedNode: undefined, isExpanded: true, onToggleExpand: () => {} })
    const chevrons = screen.getAllByText('▼')
    expect(chevrons.length).toBeGreaterThan(0)
  })

  it('clicking an ingredient tile calls onIngredientClick with the item id and subPlanId', () => {
    const onIngredientClick = vi.fn()
    const block = useBlockStore.getState().blocks[0]
    const rootPlanId = block.rootPlan.id
    renderRow({ onIngredientClick })
    // Title set when onIngredientClick is provided.
    const tile = screen.getByTitle('Iron Ore — Find producer recipe')
    fireEvent.click(tile)
    expect(onIngredientClick).toHaveBeenCalledWith('iron-ore', rootPlanId)
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
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })
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
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })
    renderRow({ planNode: electrolysisPlanNode, solvedNode: electrolysisSolved })
    // Oxygen is non-primary → its tile has title "Set as primary"
    expect(screen.getByTitle(/Set as primary/)).toBeInTheDocument()
  })

  it('clicking "Set as primary" calls updateNodePrimaryProduct', () => {
    const block = makeEmptyBlock('Test')
    const rootPlan = { ...block.rootPlan, nodes: [electrolysisPlanNode] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })
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
    const node: GameRecipeNode = { ...(electrolysisPlanNode as GameRecipeNode), pinnedRate }
    const block = makeEmptyBlock('Test')
    const rootPlan = { ...block.rootPlan, nodes: [node] }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })
    return node
  }

  it('unpinned row has no pinned input and offers "Pin rate" in the menu', () => {
    setupElectrolysis(undefined)
    renderRow({ planNode: electrolysisPlanNode, solvedNode: electrolysisSolved })
    expect(screen.queryByLabelText('Pinned rate')).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getAllByTitle('Electrolysis')[0])
    expect(screen.getByRole('menuitem', { name: 'Pin rate' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Unpin rate' })).not.toBeInTheDocument()
  })

  it('pinned row shows a pinned input and offers "Unpin rate" in the menu', () => {
    const pinned = setupElectrolysis(2)
    renderRow({ planNode: pinned, solvedNode: electrolysisSolved })
    expect(screen.getByLabelText('Pinned rate')).toBeInTheDocument()
    fireEvent.contextMenu(screen.getAllByTitle('Electrolysis')[0])
    expect(screen.getByRole('menuitem', { name: 'Unpin rate' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Pin rate' })).not.toBeInTheDocument()
  })

  it('pinning from the menu uses a value > 0 even when throughput is 0', () => {
    setupElectrolysis(undefined)
    const zeroThroughput: SolvedNode = { ...electrolysisSolved, throughput: 0 }
    renderRow({ planNode: electrolysisPlanNode, solvedNode: zeroThroughput })
    fireEvent.contextMenu(screen.getAllByTitle('Electrolysis')[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin rate' }))
    const updated = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    if (updated.kind === 'game-recipe') {
      expect(updated.pinnedRate).toBeDefined()
      expect(updated.pinnedRate!).toBeGreaterThan(0)
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
        steam: { id: 'steam', name: 'Steam', type: 'fluid' as const, iconPath: '', hidden: false, subgroup: '', order: '' },
      },
    } as typeof mockGameData

    const block = useBlockStore.getState().blocks[0]
    const rootPlan = block?.rootPlan ?? { id: 'r', name: 'Root', goals: [], nodes: [], subPlans: [], createdAt: '', updatedAt: '' }
    render(
      <RecipeDndProvider>
        <table>
          <tbody>
            <RecipeRow
              solvedNode={surplusNode}
              planNode={planNode}
              isFirst={false}
              isLast={false}
              depth={0}
              gameData={gameDataWithSteam}
              rootPlan={rootPlan}
              parentSubPlanId={rootPlan.id}
              nodeIndex={0}
            />
          </tbody>
        </table>
      </RecipeDndProvider>,
    )
    // steam appears as a byproduct tile (non-primary output — button with red-950 class)
    const steamTiles = screen.getAllByTitle(/Steam/i)
    expect(steamTiles.length).toBeGreaterThan(0)
  })
})

describe('RecipeRow context menu', () => {
  function openMenu() {
    fireEvent.contextMenu(screen.getAllByTitle('Iron Plate')[0])
  }
  const nodes = () => useBlockStore.getState().blocks[0].rootPlan.nodes

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('right-clicking the recipe icon opens a menu with the four actions', () => {
    renderRow()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    openMenu()
    expect(screen.getByRole('menu')).toBeInTheDocument()
    const labels = screen.getAllByRole('menuitem').map(i => i.textContent)
    expect(labels).toEqual(['Absorb byproduct', 'Pin rate', 'Wrap in subfactory…', 'Remove recipe'])
  })

  it('Remove recipe removes the node and closes the menu', () => {
    renderRow()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove recipe' }))
    expect(nodes()).toHaveLength(0)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Pin rate pins the node and the pinned input appears', () => {
    const { unmount } = renderRow()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin rate' }))
    const node = nodes()[0]
    expect(node.kind === 'game-recipe' && node.pinnedRate).toBeGreaterThan(0)
    // Props are static in the harness: re-render with the updated store node.
    unmount()
    renderRow({ planNode: node })
    expect(screen.getByLabelText('Pinned rate')).toBeInTheDocument()
  })

  it('a pinned node offers Unpin rate', () => {
    const pinned: RecipeNode = { ...ironPlateRecipeNode, pinnedRate: 2 }
    const block = makeEmptyBlock('Test')
    useBlockStore.setState({
      blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [pinned] } }],
      activeBlockId: block.id,
      history: {},
    })
    renderRow({ planNode: pinned })
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unpin rate' }))
    const node = nodes()[0]
    expect(node.kind === 'game-recipe' && node.pinnedRate).toBeUndefined()
  })

  it('a byproduct consumer shows Stop absorbing byproduct and no pin item', () => {
    const bc: RecipeNode = { ...ironPlateRecipeNode, byproductConsumer: true }
    renderRow({ planNode: bc })
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Stop absorbing byproduct' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /pin rate/i })).not.toBeInTheDocument()
  })

  it('Absorb byproduct marks the node as a byproduct consumer', () => {
    renderRow()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Absorb byproduct' }))
    const node = nodes()[0]
    expect(node.kind === 'game-recipe' && node.byproductConsumer).toBe(true)
  })

  it('Wrap in subfactory prompts for a name and wraps the node', () => {
    const prompt = vi.fn().mockReturnValue('My group')
    vi.stubGlobal('prompt', prompt)
    renderRow()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wrap in subfactory…' }))
    expect(prompt).toHaveBeenCalledWith('Subfactory name:', 'Iron Plate')
    expect(nodes()[0].kind).toBe('subplan')
  })

  it('Escape closes the menu', () => {
    renderRow()
    openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('mousedown outside closes the menu', () => {
    renderRow()
    openMenu()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('right-clicking inside the open menu keeps it in place', () => {
    renderRow()
    fireEvent.contextMenu(screen.getAllByTitle('Iron Plate')[0], { clientX: 10, clientY: 20 })
    const menu = screen.getByRole('menu')
    const { left, top } = menu.style
    fireEvent.contextMenu(screen.getAllByRole('menuitem')[0], { clientX: 300, clientY: 400 })
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    expect(screen.getByRole('menu').style.left).toBe(left)
    expect(screen.getByRole('menu').style.top).toBe(top)
  })

  it('mousedown inside the menu does not close it', () => {
    renderRow()
    openMenu()
    fireEvent.mouseDown(screen.getAllByRole('menuitem')[0])
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('scrolling closes the menu', () => {
    renderRow()
    openMenu()
    fireEvent.scroll(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('window blur closes the menu', () => {
    renderRow()
    openMenu()
    fireEvent.blur(window)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shifts the menu back inside the viewport', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 160, height: 120, x: 0, y: 0, top: 0, left: 0, right: 160, bottom: 120,
      toJSON: () => ({}),
    })
    vi.stubGlobal('innerWidth', 500)
    vi.stubGlobal('innerHeight', 300)
    renderRow()
    fireEvent.contextMenu(screen.getAllByTitle('Iron Plate')[0], { clientX: 480, clientY: 290 })
    const menu = screen.getByRole('menu')
    expect(menu.style.left).toBe('340px')
    expect(menu.style.top).toBe('180px')
  })

  it('right-clicking a non-recipe cell does not open the menu', () => {
    renderRow()
    fireEvent.contextMenu(screen.getByText('⚡'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Research horizon: machine and module cells
// ---------------------------------------------------------------------------

function makeHorizonGameData(): GameData {
  const base = structuredClone(mockGameData)
  const machine = (id: string, name: string, craftingSpeed: number) => ({
    ...base.machines['electric-furnace'], id, name, craftingSpeed,
  })
  const placer = (id: string) => ({ id, name: id, type: 'item', iconPath: '', hidden: false, placeResult: id })
  const maker = (id: string, itemId: string) => ({
    ...base.recipes['iron-plate'], id, name: id, ingredients: [],
    products: [{ itemId, type: 'item', amount: 1 }], mainProduct: itemId,
  })
  return {
    ...base,
    items: { ...base.items, 'furnace-1': placer('furnace-1'), 'electric-furnace': placer('electric-furnace'), 'speed-1': placer('speed-1') } as unknown as GameData['items'],
    recipes: { ...base.recipes, 'r-f1': maker('r-f1', 'furnace-1'), 'r-ef': maker('r-ef', 'electric-furnace'), 'r-speed': maker('r-speed', 'speed-1') } as unknown as GameData['recipes'],
    machines: {
      'furnace-1': machine('furnace-1', 'Furnace 1', 1),
      'electric-furnace': machine('electric-furnace', 'Electric Furnace', 2),
    } as unknown as GameData['machines'],
    modules: {
      'speed-1': { id: 'speed-1', name: 'Speed 1', category: 'speed', tier: 1, effects: { speed: 0.2 }, limitation: [], limitationBlacklist: [], iconPath: '' },
    },
    technologies: {
      base: { id: 'base', name: 'Base', prerequisites: [], unlockedRecipes: ['iron-plate', 'r-f1'], iconPath: '' },
      none: { id: 'none', name: 'None', prerequisites: [], unlockedRecipes: ['iron-plate'], iconPath: '' },
      late: { id: 'late', name: 'Late', prerequisites: ['base'], unlockedRecipes: ['r-ef', 'r-speed'], iconPath: '' },
    },
  }
}

describe('RecipeRow — research horizon', () => {
  it('uses the horizon default machine without flagging it', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    renderRow({ gameData: makeHorizonGameData() })
    expect(screen.getByTitle('Furnace 1')).not.toHaveAttribute('data-beyond-horizon')
  })

  it('flags an explicit machine outside the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    renderRow({
      gameData: makeHorizonGameData(),
      planNode: { ...ironPlateRecipeNode, machineId: 'electric-furnace' } as RecipeNode,
    })
    const cell = screen.getByTitle(/ \(beyond research horizon\)$/)
    expect(cell).toHaveAttribute('data-beyond-horizon', 'true')
    expect(cell).toHaveAttribute('title', 'Electric Furnace (beyond research horizon)')
  })

  describe('no machine within the horizon', () => {
    function noMachineData(): GameData {
      const d = makeHorizonGameData()
      d.technologies.base.unlockedRecipes = ['iron-plate']
      d.technologies.late.unlockedRecipes = ['r-f1', 'r-ef', 'r-speed']
      return d
    }
    beforeEach(() => useBlockStore.setState({ horizonTechnologyIds: ['base'] }))

    it('flags the machine cell as having no machine', () => {
      renderRow({ gameData: noMachineData(), solvedNode: { ...solvedNode, machineCountCeil: 0 } })
      // The disabled beacon "+" carries the same title; the machine cell is the flagged one.
      const cell = screen.getAllByTitle('No machine within research horizon').find(e => e.hasAttribute('data-no-machine'))
      expect(cell).toHaveAttribute('data-beyond-horizon', 'true')
      expect(screen.getByLabelText('Add beacon')).toBeDisabled()
    })

    it('shows configured modules even though there are no slots', () => {
      renderRow({
        gameData: noMachineData(),
        planNode: { ...ironPlateRecipeNode, modules: [{ moduleId: 'speed-1', count: 1 }] } as RecipeNode,
      })
      expect(screen.getByTitle('Modules without a machine')).toHaveTextContent('1/0')
    })

    it('shows no module cell without modules', () => {
      renderRow({ gameData: noMachineData() })
      expect(screen.queryByTitle('Modules without a machine')).not.toBeInTheDocument()
      expect(screen.queryByTitle(/Edit modules/)).not.toBeInTheDocument()
    })
  })
})
