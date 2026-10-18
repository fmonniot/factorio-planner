import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSolverStore, wireSolver, selectSolverResult, selectBlockResult } from './solverStore'
import { useBlockStore, makeEmptyBlock } from './blockStore'
import { useGameDataStore } from './gameDataStore'
import type { GameData } from '../data/types'

// Use fake timers to control debounce without real waiting.
vi.useFakeTimers()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGameDataJson(overrides: Partial<GameData> = {}): string {
  const data: GameData = {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {},
    recipes: {},
    machines: {},
    modules: {},
    beacons: {},
    defaultMachines: {},
    itemGroups: {},
    itemSubgroups: {},
    technologies: {},
    startingRecipes: [],
    ...overrides,
  }
  return JSON.stringify(data)
}

function loadGameData(overrides: Partial<GameData> = {}) {
  useGameDataStore.getState().importGameData(makeGameDataJson(overrides), 'test')
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let unwire: (() => void) | undefined

beforeEach(() => {
  const block = makeEmptyBlock('Test')
  useBlockStore.setState({
    blocks: [block],
    activeBlockId: block.id,
    history: {},
  })
  useGameDataStore.setState({ status: { type: 'empty' } })
  useSolverStore.setState({ status: { type: 'idle' }, lastResult: undefined, lastResults: {}, lastErrors: {}, flows: [] })
  unwire = wireSolver()
})

afterEach(() => {
  unwire?.()
  vi.clearAllTimers()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('wireSolver', () => {
  it('stays idle when no game data is loaded', () => {
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    vi.runAllTimers()
    expect(useSolverStore.getState().status.type).toBe('idle')
  })

  it('produces a solved result for an empty plan (no goals)', () => {
    loadGameData()
    vi.runAllTimers()
    const { status } = useSolverStore.getState()
    expect(status.type).toBe('solved')
    if (status.type === 'solved') {
      expect(status.result.nodes).toHaveLength(0)
    }
  })

  it('transitions to pending while debounce is active', () => {
    loadGameData()
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    // debounce has not fired yet
    expect(useSolverStore.getState().status.type).toBe('pending')
  })

  it('re-solves when the plan changes', () => {
    loadGameData()
    vi.runAllTimers()
    expect(useSolverStore.getState().status.type).toBe('solved')

    // Mutate plan
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    expect(useSolverStore.getState().status.type).toBe('pending')
    vi.runAllTimers()
    expect(useSolverStore.getState().status.type).toBe('solved')
  })

  it('re-solves when game data changes', () => {
    vi.runAllTimers() // initial idle

    loadGameData()
    expect(useSolverStore.getState().status.type).toBe('pending')
    vi.runAllTimers()
    expect(useSolverStore.getState().status.type).toBe('solved')
  })

  it('debounces multiple rapid plan changes into a single pending then solved', () => {
    loadGameData()
    vi.runAllTimers()

    // Make three rapid changes without advancing timers.
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 10 })
    useBlockStore.getState().updateGoalRate('g1', 20)
    useBlockStore.getState().updateGoalRate('g1', 30)

    // Only pending before timer fires — not yet solved multiple times.
    expect(useSolverStore.getState().status.type).toBe('pending')

    vi.runAllTimers()
    // Settled after the single debounced run.
    expect(useSolverStore.getState().status.type).toBe('solved')
  })

  it('unsubscribes cleanly on unwire', () => {
    loadGameData()
    vi.runAllTimers()
    unwire!()
    unwire = undefined

    useSolverStore.setState({ status: { type: 'idle' }, lastResult: undefined })
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    vi.runAllTimers()
    // Store should remain idle after unwire
    expect(useSolverStore.getState().status.type).toBe('idle')
  })

  it('returns empty result (not error) for plan with goals but no nodes', () => {
    loadGameData()
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    vi.runAllTimers()
    const { status } = useSolverStore.getState()
    expect(status.type).toBe('solved')
    if (status.type === 'solved') {
      expect(status.result.nodes).toHaveLength(0)
    }
  })
})

describe('selectSolverResult', () => {
  it('returns undefined when idle', () => {
    expect(selectSolverResult(useSolverStore.getState())).toBeUndefined()
  })

  it('returns result when solved', () => {
    loadGameData()
    vi.runAllTimers()
    expect(selectSolverResult(useSolverStore.getState())).toBeDefined()
  })
})

describe('wireSolver — several blocks', () => {
  const plateRecipe = {
    id: 'plate', name: 'plate', category: 'crafting', craftingTime: 1,
    ingredients: [], products: [{ itemId: 'plate', type: 'item', amount: 1 }],
    madeIn: [], allowProductivity: false, hidden: false, subgroup: '', order: '',
  }
  const gearRecipe = {
    ...plateRecipe, id: 'gear', name: 'gear',
    ingredients: [{ itemId: 'plate', type: 'item', amount: 2 }],
    products: [{ itemId: 'gear', type: 'item', amount: 1 }],
  }
  const node = (id: string, recipeId: string) =>
    ({ kind: 'game-recipe' as const, id, recipeId, modules: [], byproductPolicy: {} })

  /** Plates (60/min) feeding Gears (30/min). Returns [plates, gears]. */
  function setupTwoBlocks(activeIndex: 0 | 1) {
    const plates = makeEmptyBlock('Plates')
    const gears = makeEmptyBlock('Gears')
    useBlockStore.setState({
      blocks: [
        { ...plates, goals: [{ id: 'gp', itemId: 'plate', rate: 60 }], rootPlan: { ...plates.rootPlan, nodes: [node('p', 'plate')] } },
        {
          ...gears,
          goals: [{ id: 'gg', itemId: 'gear', rate: 30 }],
          inputConnections: [{ id: 'c1', itemId: 'plate', fromBlockId: plates.id }],
          rootPlan: { ...gears.rootPlan, nodes: [node('g', 'gear')] },
        },
      ],
      activeBlockId: [plates, gears][activeIndex].id,
      history: {},
    })
    loadGameData({ recipes: { plate: plateRecipe, gear: gearRecipe } as unknown as GameData['recipes'] })
    vi.runAllTimers()
    return [plates, gears]
  }

  it('solves every block and keeps the active block as lastResult', () => {
    const [plates, gears] = setupTwoBlocks(1)
    const state = useSolverStore.getState()
    expect(Object.keys(state.lastResults).sort()).toEqual([plates.id, gears.id].sort())
    expect(state.flows).toHaveLength(1)
    expect(state.flows[0]).toMatchObject({ connectionId: 'c1', status: 'ok' })
    expect(state.flows[0].rate).toBeCloseTo(60, 4)
    expect(state.status.type === 'solved' && state.status.result).toBe(state.lastResults[gears.id])
  })

  it('swaps lastResult when the active block changes', () => {
    const [plates, gears] = setupTwoBlocks(1)
    useBlockStore.getState().setActiveBlock(plates.id)
    vi.runAllTimers()
    expect(useSolverStore.getState().lastResult).toBe(useSolverStore.getState().lastResults[plates.id])
    expect(useSolverStore.getState().lastResult).not.toBe(useSolverStore.getState().lastResults[gears.id])
  })

  it('swaps to the new block immediately, without re-solving', () => {
    const [plates, gears] = setupTwoBlocks(1)
    const before = useSolverStore.getState().lastResults
    useBlockStore.getState().setActiveBlock(plates.id)
    // No timers have run: the stored result is already the new block's.
    const state = useSolverStore.getState()
    expect(state.lastResult).toBe(before[plates.id])
    expect(state.lastResult).not.toBe(before[gears.id])
    expect(state.status.type === 'solved' && state.status.result).toBe(before[plates.id])
    vi.runAllTimers()
    expect(useSolverStore.getState().lastResults).toBe(before)
  })

  it('selectBlockResult follows the requested block, not the last solved one', () => {
    const [plates, gears] = setupTwoBlocks(1)
    const state = useSolverStore.getState()
    expect(selectBlockResult(plates.id)(state)).toBe(state.lastResults[plates.id])
    expect(selectBlockResult(gears.id)(state)).toBe(state.lastResults[gears.id])
  })

  it('keeps the status solved when an inactive block fails', () => {
    const [plates] = setupTwoBlocks(1)
    useBlockStore.setState(s => ({
      blocks: s.blocks.map(b => b.id === plates.id
        ? { ...b, rootPlan: { ...b.rootPlan, nodes: [{ ...node('p', 'plate'), modules: undefined } as never] } }
        : b),
    }))
    vi.runAllTimers()
    expect(useSolverStore.getState().status.type).toBe('solved')
  })

  it('reports an error when the active block fails', () => {
    const [plates] = setupTwoBlocks(0)
    useBlockStore.setState(s => ({
      blocks: s.blocks.map(b => b.id === plates.id
        ? { ...b, rootPlan: { ...b.rootPlan, nodes: [{ ...node('p', 'plate'), modules: undefined } as never] } }
        : b),
    }))
    vi.runAllTimers()
    expect(useSolverStore.getState().status.type).toBe('error')
  })
})

describe('wireSolver — research horizon machines', () => {
  const plate = () => ({
    id: 'plate', name: 'plate', category: 'crafting', craftingTime: 1,
    ingredients: [], products: [{ itemId: 'plate', type: 'item', amount: 1 }],
    madeIn: [], allowProductivity: false, hidden: false, subgroup: '', order: '',
  })
  const machine = (id: string, craftingSpeed: number, category = 'crafting') => ({
    id, name: id, type: 'assembling-machine', craftingSpeed, energyUsageKw: 100, energyType: 'electric',
    drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: [category], iconPath: '', hidden: false,
  })
  const item = (id: string, placeResult: string) =>
    ({ id, name: id, type: 'item' as const, iconPath: '', hidden: false, subgroup: '', order: '', placeResult })
  const tech = (id: string, unlockedRecipes: string[]) =>
    ({ id, name: id, prerequisites: [], unlockedRecipes, iconPath: '' })

  function setup() {
    useBlockStore.getState().setHorizonTechnologyIds([])
    loadGameData({
      items: { am1: item('am1', 'am1'), am2: item('am2', 'am2') },
      recipes: {
        plate: plate(), 'r-am1': { ...plate(), id: 'r-am1', products: [{ itemId: 'am1', type: 'item', amount: 1 }] },
        'r-am2': { ...plate(), id: 'r-am2', products: [{ itemId: 'am2', type: 'item', amount: 1 }] },
      } as unknown as GameData['recipes'],
      machines: { am1: machine('am1', 1), am2: machine('am2', 2) } as unknown as GameData['machines'],
      defaultMachines: { crafting: 'am2' },
      technologies: { base: tech('base', ['plate', 'r-am1']), late: tech('late', ['r-am2']) },
      startingRecipes: [],
    })
    const block = useBlockStore.getState().blocks[0]
    useBlockStore.setState({
      blocks: [{
        ...block,
        goals: [{ id: 'g', itemId: 'plate', rate: 60 }],
        rootPlan: { ...block.rootPlan, nodes: [{ kind: 'game-recipe', id: 'n1', recipeId: 'plate', modules: [], byproductPolicy: {} }] },
      }],
    })
    vi.runAllTimers()
  }
  const solvedNode = () => {
    const { status } = useSolverStore.getState()
    if (status.type !== 'solved') throw new Error(`status ${status.type}`)
    return status.result.nodes[0]
  }

  it('solves rows without a machine with the horizon default machine', () => {
    setup()
    const full = solvedNode().machineCountExact
    useBlockStore.getState().setHorizonTechnologyIds(['base'])
    vi.runAllTimers()
    expect(solvedNode().machineCountExact).toBeCloseTo(full * 2)
    const node = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(node.kind === 'game-recipe' && node.machineId).toBeUndefined()
  })

  it('solves a category with no machine in the horizon to zero machines', () => {
    setup()
    const full = solvedNode().throughput
    loadGameData({
      items: { am1: item('am1', 'am1'), am2: item('am2', 'am2') },
      recipes: {
        plate: plate(), 'r-am1': { ...plate(), id: 'r-am1', products: [{ itemId: 'am1', type: 'item', amount: 1 }] },
        'r-am2': { ...plate(), id: 'r-am2', products: [{ itemId: 'am2', type: 'item', amount: 1 }] },
      } as unknown as GameData['recipes'],
      machines: { am1: machine('am1', 1), am2: machine('am2', 2) } as unknown as GameData['machines'],
      defaultMachines: { crafting: 'am2' },
      technologies: { base: tech('base', ['plate']), late: tech('late', ['r-am1', 'r-am2']) },
      startingRecipes: [],
    })
    useBlockStore.getState().setHorizonTechnologyIds(['base'])
    vi.runAllTimers()
    const n = solvedNode()
    expect(useSolverStore.getState().status.type).toBe('solved')
    expect(n.machineCountCeil).toBe(0)
    expect(n.powerKw).toBe(0)
    expect(n.throughput).toBe(full)
  })
})
