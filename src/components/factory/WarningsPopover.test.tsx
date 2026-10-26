import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WarningsPopover } from './WarningsPopover'
import { useSolverStore } from '../../store/solverStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import type { GameData, GameRecipeNode, SolverResult, SubPlan } from '../../data/types'

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
})
