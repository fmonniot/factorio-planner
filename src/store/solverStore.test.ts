import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSolverStore, wireSolver, selectSolverResult } from './solverStore'
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
    ...overrides,
  }
  return JSON.stringify(data)
}

function loadGameData(overrides: Partial<GameData> = {}) {
  useGameDataStore.getState().importGameData(makeGameDataJson(overrides))
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
  useSolverStore.setState({ status: { type: 'idle' }, lastResult: undefined })
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
