import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WarningsPopover } from './TableToolbar'
import { useSolverStore } from '../../store/solverStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import type { GameData, GameRecipeNode, SolverResult, SolverWarning, SubPlan } from '../../data/types'

// ---------------------------------------------------------------------------
// Minimal GameData with recipe and item names
// ---------------------------------------------------------------------------

const mockGameData: GameData = {
  factorioVersion: '2.0.0',
  modSet: {},
  items: {
    steam: { id: 'steam', name: 'Steam', type: 'fluid', iconPath: '', hidden: false },
    oxygen: { id: 'oxygen', name: 'Oxygen', type: 'fluid', iconPath: '', hidden: false },
    'iron-plate': { id: 'iron-plate', name: 'Iron Plate', type: 'item', iconPath: '', hidden: false },
  },
  recipes: {
    'boiler': { id: 'boiler', name: 'Boiler Recipe', category: 'crafting', craftingTime: 1, ingredients: [], products: [], madeIn: [], allowProductivity: false, mainProduct: undefined, hidden: false },
  },
  machines: {},
  modules: {},
  defaultMachines: {},
} as unknown as GameData

function setupWithWarnings(result: Partial<SolverResult>) {
  useGameDataStore.setState({ status: { type: 'loaded', gameData: mockGameData, sourceId: 'test' } })
  useSolverStore.setState({
    status: { type: 'idle' },
    lastResult: { nodes: [], unsatisfied: [], warnings: [], ...result },
    _setStatus: () => {},
  })
}

function openPopover() {
  fireEvent.click(screen.getByTitle('Show solver warnings'))
}

beforeEach(() => {
  useGameDataStore.setState({ status: { type: 'loaded', gameData: mockGameData, sourceId: 'test' } })
})

// ---------------------------------------------------------------------------
// no-recipe
// ---------------------------------------------------------------------------

describe('WarningsPopover — no-recipe', () => {
  beforeEach(() => {
    setupWithWarnings({ warnings: [{ type: 'no-recipe', itemId: 'iron-plate' }] })
    render(<WarningsPopover />)
    openPopover()
  })

  it('shows title "No recipe in plan"', () => {
    expect(screen.getByText(/No recipe in plan/i)).toBeInTheDocument()
  })

  it('body contains the item name', () => {
    expect(screen.getByText(/Iron Plate/i)).toBeInTheDocument()
  })

  it('hint mentions adding a recipe node', () => {
    expect(screen.getByText(/add a recipe node/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// overconstrained
// ---------------------------------------------------------------------------

describe('WarningsPopover — overconstrained', () => {
  beforeEach(() => {
    setupWithWarnings({ warnings: [{ type: 'overconstrained', surplusItems: [{ itemId: 'steam', rate: 15 }, { itemId: 'oxygen', rate: 5 }] }] })
    render(<WarningsPopover />)
    openPopover()
  })

  it("shows title \"Recipe network can't fully balance\"", () => {
    expect(screen.getByText(/can't fully balance/i)).toBeInTheDocument()
  })

  it('body contains surplus item names', () => {
    expect(screen.getByText(/Steam.*Oxygen|Oxygen.*Steam/i)).toBeInTheDocument()
  })

  it('hint mentions material loop', () => {
    expect(screen.getByText(/material loop/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// loop-not-converged
// ---------------------------------------------------------------------------

describe('WarningsPopover — loop-not-converged', () => {
  beforeEach(() => {
    useBlockStore.setState({
      blocks: [{ ...makeEmptyBlock('Metals'), id: 'm' }, { ...makeEmptyBlock('Ores'), id: 'o' }],
      activeBlockId: 'm',
    })
    setupWithWarnings({ warnings: [{ type: 'loop-not-converged', blockIds: ['m', 'o'], rounds: 8 }] })
    render(<WarningsPopover />)
    openPopover()
  })

  it('shows the title', () => {
    expect(screen.getByText(/Loop between blocks did not settle/)).toBeInTheDocument()
  })

  it('names the blocks around the loop and the rounds', () => {
    expect(screen.getByText(/Metals → Ores → Metals.*after 8 rounds/)).toBeInTheDocument()
  })

  it('hint suggests removing or limiting a connection', () => {
    expect(screen.getByText(/set a limit on one/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// request-loop-not-converged
// ---------------------------------------------------------------------------

describe('WarningsPopover — request-loop-not-converged', () => {
  beforeEach(() => {
    useBlockStore.setState({
      blocks: [{ ...makeEmptyBlock('Metals'), id: 'm' }, { ...makeEmptyBlock('Ores'), id: 'o' }],
      activeBlockId: 'm',
    })
    setupWithWarnings({ warnings: [{ type: 'request-loop-not-converged', blockIds: ['m', 'o'], rounds: 3 }] })
    render(<WarningsPopover />)
    openPopover()
  })

  it('shows the title', () => {
    expect(screen.getByText(/Requests around a loop do not settle/)).toBeInTheDocument()
  })

  it('names the blocks around the loop and the rounds', () => {
    expect(screen.getByText(/requests around the loop Metals → Ores → Metals did not settle after 3 rounds/)).toBeInTheDocument()
    expect(screen.getByText(/only take what is left over/)).toBeInTheDocument()
  })

  it('hint suggests limiting or removing a request', () => {
    expect(screen.getByText(/Set a limit on one of the loop's requests, or remove one/)).toBeInTheDocument()
  })

  it('is not critical', () => {
    expect(screen.getByText(/Requests around a loop do not settle/).className).toContain('text-yellow-400')
  })
})

// ---------------------------------------------------------------------------
// temperature-mismatch
// ---------------------------------------------------------------------------

describe('WarningsPopover — temperature-mismatch', () => {
  beforeEach(() => {
    useGameDataStore.setState({
      status: {
        type: 'loaded',
        gameData: {
          ...mockGameData,
          recipes: {
            ...mockGameData.recipes,
            turbine: { id: 'turbine', name: 'Steam Turbine', category: 'crafting', craftingTime: 1, ingredients: [], products: [], madeIn: [], allowProductivity: false, mainProduct: undefined, hidden: false },
          },
        } as unknown as GameData,
        sourceId: 'test',
      },
    })
    useSolverStore.setState({
      status: { type: 'idle' },
      lastResult: {
        nodes: [], unsatisfied: [],
        warnings: [{ type: 'temperature-mismatch', recipeId: 'turbine', itemId: 'steam', supplied: [165], minimum: 465 }],
      },
      _setStatus: () => {},
    })
    render(<WarningsPopover />)
    openPopover()
  })

  it('shows the title, the need and the supplied temperature', () => {
    expect(screen.getByText(/Fluid temperature does not fit/)).toBeInTheDocument()
    expect(screen.getByText('Steam Turbine needs Steam at ≥465°C, but it is only supplied at 165°C.')).toBeInTheDocument()
  })

  it('hints at a boiler or a connected block', () => {
    expect(screen.getByText(/Use a boiler or recipe whose output is in range/)).toBeInTheDocument()
  })

  it('is not critical: the pill stays amber and counts it', () => {
    expect(screen.getByText(/Fluid temperature does not fit/).className).toContain('text-yellow-400')
    const pill = screen.getByTitle('Show solver warnings')
    expect(pill).toHaveTextContent('1 warning')
    expect(pill.className).toContain('text-yellow-300')
  })
})

// ---------------------------------------------------------------------------
// coproduct-driven
// ---------------------------------------------------------------------------

describe('WarningsPopover — coproduct-driven', () => {
  function driven(recipeId: string, throughput: number, needed: number): SolverWarning {
    return { type: 'coproduct-driven', drivers: [{ recipeId, itemIds: ['steam', 'oxygen'], throughput, needed }] }
  }

  it('shows the title, the co-products, the share, the hint and stays amber', () => {
    setupWithWarnings({ warnings: [driven('boiler', 150, 60)] })
    render(<WarningsPopover />)
    openPopover()
    const title = screen.getByText(/Recipe runs for its co-product/)
    expect(title.className).toContain('text-yellow-400')
    expect(screen.getByText(/"Boiler Recipe" runs mainly to make Steam, Oxygen as a co-product/)).toBeInTheDocument()
    expect(screen.getByText(/about 40%/)).toBeInTheDocument()
    expect(screen.getByText(/Byproducts first/)).toBeInTheDocument()
    expect(screen.getByText(/pin the recipe/)).toBeInTheDocument()
    expect(screen.getByTitle('Show solver warnings').className).toContain('text-yellow-300')
  })

  it.each([[0.5], [0]])('says "under 1%" for a need of %s', (needed) => {
    setupWithWarnings({ warnings: [driven('boiler', 150, needed)] })
    render(<WarningsPopover />)
    openPopover()
    expect(screen.getByText(/under 1%/)).toBeInTheDocument()
  })

  it('falls back to the raw id for an unknown recipe', () => {
    setupWithWarnings({ warnings: [driven('mystery', 150, 60)] })
    render(<WarningsPopover />)
    openPopover()
    expect(screen.getByText(/"mystery" runs mainly to make/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// infeasible-pins
// ---------------------------------------------------------------------------

describe('WarningsPopover — infeasible-pins', () => {
  beforeEach(() => {
    setupWithWarnings({ warnings: [{ type: 'infeasible-pins', recipeIds: ['boiler'] }] })
    render(<WarningsPopover />)
    openPopover()
  })

  it('shows title "Pinned rate is impossible"', () => {
    expect(screen.getByText(/Pinned rate is impossible/i)).toBeInTheDocument()
  })

  it('body contains the recipe name', () => {
    expect(screen.getByText(/Boiler Recipe/i)).toBeInTheDocument()
  })

  it('hint mentions unpinning', () => {
    expect(screen.getByText(/unpin/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// areas: area-shortfall and duplicate-recipe per area
// ---------------------------------------------------------------------------

function node(id: string, recipeId: string): GameRecipeNode {
  return { kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {} }
}

function plan(id: string, name: string, nodes: GameRecipeNode[], subPlans: SubPlan[] = [], area?: boolean): SubPlan {
  return { id, name, nodes, subPlans, ...(area ? { area } : {}), createdAt: '', updatedAt: '' }
}

function setupAreaBlock() {
  const block = makeEmptyBlock('Block')
  const plastics = plan('plastics', 'Plastics', [node('boiler-p', 'boiler'), node('boiler-p2', 'boiler')], [], true)
  const rootPlan = {
    ...block.rootPlan,
    nodes: [node('boiler-root', 'boiler'), node('boiler-root2', 'boiler')],
    subPlans: [plastics],
  }
  useBlockStore.setState({ blocks: [{ ...block, rootPlan }], activeBlockId: block.id, history: {} })
  return { block, rootPlan }
}

describe('WarningsPopover — area-shortfall', () => {
  beforeEach(() => {
    const { rootPlan } = setupAreaBlock()
    useUiStore.setState({ rateUnit: 'min' })
    setupWithWarnings({
      warnings: [{ type: 'area-shortfall', shortfalls: [{ areaId: 'plastics', itemId: 'steam', rate: 52 }] }],
    })
    expect(rootPlan.subPlans).toHaveLength(1)
    render(<WarningsPopover />)
    openPopover()
  })

  it('shows the title and a body naming the area, rate and item', () => {
    expect(screen.getByText(/Area can't cover its own need/)).toBeInTheDocument()
    expect(screen.getByText('Plastics takes 52.0/m of Steam from other areas, though it has its own row for it.')).toBeInTheDocument()
  })

  it('hint suggests unpinning or allowing imports, and the warning is not critical', () => {
    expect(screen.getByText(/Unpin that row, or allow imports of its inputs/)).toBeInTheDocument()
    expect(screen.getByText(/Area can't cover its own need/).className).toContain('text-yellow-400')
  })
})

describe('WarningsPopover — duplicate-recipe in an area', () => {
  const nodeIds = () => {
    const root = useBlockStore.getState().blocks[0].rootPlan
    return [...root.nodes, ...root.subPlans.flatMap(sp => sp.nodes)].map(n => n.id)
  }

  beforeEach(() => {
    setupAreaBlock()
    setupWithWarnings({
      warnings: [{ type: 'duplicate-recipe', recipeId: 'boiler', count: 2, areaId: 'plastics' }],
    })
    render(<WarningsPopover />)
    openPopover()
  })

  it('names the area and suggests separating a sub-factory', () => {
    expect(screen.getByText(/"Boiler Recipe" appears on 2 rows in Plastics\./)).toBeInTheDocument()
    expect(screen.getByText(/or make one of their sub-factories a separate area/)).toBeInTheDocument()
  })

  it('"Fix: remove duplicates" removes only the extra row of that area', () => {
    fireEvent.click(screen.getByText('Fix: remove duplicates'))
    expect(nodeIds()).toEqual(['boiler-root', 'boiler-root2', 'boiler-p'])
  })
})

// ---------------------------------------------------------------------------
// Links to the cause
// ---------------------------------------------------------------------------

describe('WarningsPopover — links', () => {
  it('a recipe warning links to the first row of the recipe and reveals it', () => {
    setupAreaBlock()
    useUiStore.setState({ revealRowRequest: null })
    setupWithWarnings({ warnings: [{ type: 'temperature-mismatch', recipeId: 'boiler', itemId: 'steam', supplied: [165], minimum: 465 }] })
    render(<WarningsPopover />)
    openPopover()
    fireEvent.click(screen.getByRole('button', { name: 'Go to Boiler Recipe' }))
    expect(useUiStore.getState().revealRowRequest?.nodeId).toBe('boiler-root')
    expect(screen.queryByTestId('warnings-popover')).toBeNull()
  })

  it('an area duplicate links to the row inside that area', () => {
    setupAreaBlock()
    setupWithWarnings({ warnings: [{ type: 'duplicate-recipe', recipeId: 'boiler', count: 2, areaId: 'plastics' }] })
    render(<WarningsPopover />)
    openPopover()
    fireEvent.click(screen.getByRole('button', { name: 'Go to Boiler Recipe' }))
    expect(useUiStore.getState().revealRowRequest?.nodeId).toBe('boiler-p')
  })

  it('an area shortfall links to the area\'s handle row', () => {
    const { block, rootPlan } = setupAreaBlock()
    const handle = { kind: 'subplan' as const, id: 'handle-plastics', subPlanId: 'plastics' }
    useBlockStore.setState({ blocks: [{ ...block, rootPlan: { ...rootPlan, nodes: [...rootPlan.nodes, handle] } }], activeBlockId: block.id })
    setupWithWarnings({ warnings: [{ type: 'area-shortfall', shortfalls: [{ areaId: 'plastics', itemId: 'steam', rate: 52 }] }] })
    render(<WarningsPopover />)
    openPopover()
    fireEvent.click(screen.getByRole('button', { name: 'Go to Plastics' }))
    expect(useUiStore.getState().revealRowRequest?.nodeId).toBe('handle-plastics')
  })

  it('a loop warning links to each block and switches to it', () => {
    useBlockStore.setState({
      blocks: [{ ...makeEmptyBlock('Metals'), id: 'm' }, { ...makeEmptyBlock('Ores'), id: 'o' }],
      activeBlockId: 'm',
    })
    setupWithWarnings({ warnings: [{ type: 'loop-not-converged', blockIds: ['m', 'o'], rounds: 8 }] })
    render(<WarningsPopover />)
    openPopover()
    expect(screen.queryByRole('button', { name: 'Go to Metals' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Go to Ores' }))
    expect(useBlockStore.getState().activeBlockId).toBe('o')
  })

  it('a recipe named twice links to its row once', () => {
    setupAreaBlock()
    setupWithWarnings({ warnings: [{ type: 'infeasible-pins', recipeIds: ['boiler', 'boiler'] }] })
    render(<WarningsPopover />)
    openPopover()
    expect(screen.getAllByTestId('warning-link')).toHaveLength(1)
  })

  it('an area duplicate in a block without areas links to the recipe\'s row', () => {
    const block = makeEmptyBlock('Flat')
    useBlockStore.setState({ blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [node('b1', 'boiler'), node('b2', 'boiler')] } }], activeBlockId: block.id, history: {} })
    setupWithWarnings({ warnings: [{ type: 'duplicate-recipe', recipeId: 'boiler', count: 2, areaId: 'gone' }] })
    render(<WarningsPopover />)
    openPopover()
    fireEvent.click(screen.getByRole('button', { name: 'Go to Boiler Recipe' }))
    expect(useUiStore.getState().revealRowRequest?.nodeId).toBe('b1')
  })

  it('a warning that names only items has no link', () => {
    setupWithWarnings({ warnings: [{ type: 'no-recipe', itemId: 'iron-plate' }] })
    render(<WarningsPopover />)
    openPopover()
    expect(screen.queryByTestId('warning-link')).toBeNull()
  })

  it('a recipe with no row in the block has no link', () => {
    setupAreaBlock()
    setupWithWarnings({ warnings: [{ type: 'infeasible-pins', recipeIds: ['gone'] }] })
    render(<WarningsPopover />)
    openPopover()
    expect(screen.queryByTestId('warning-link')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Pill
// ---------------------------------------------------------------------------

describe('WarningsPopover — pill', () => {
  it('reports whether the popover is open', () => {
    setupWithWarnings({ warnings: [{ type: 'no-recipe', itemId: 'iron-plate' }] })
    render(<WarningsPopover />)
    const pill = screen.getByTitle('Show solver warnings')
    expect(pill).toHaveAttribute('aria-haspopup', 'dialog')
    expect(pill).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(pill)
    expect(pill).toHaveAttribute('aria-expanded', 'true')
  })

  it('ignores an Escape another layer already handled, and closes on a plain one', () => {
    setupWithWarnings({ warnings: [{ type: 'no-recipe', itemId: 'iron-plate' }] })
    render(<WarningsPopover />)
    const pill = screen.getByTitle('Show solver warnings')
    fireEvent.click(pill)
    const handled = (e: KeyboardEvent) => e.preventDefault()
    window.addEventListener('keydown', handled, true)
    fireEvent.keyDown(window, { key: 'Escape' })
    window.removeEventListener('keydown', handled, true)
    expect(pill).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(pill).toHaveAttribute('aria-expanded', 'false')
  })
})
