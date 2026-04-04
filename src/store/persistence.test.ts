import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  PLAN_STORAGE_KEY,
  savePlan,
  loadPersistedPlan,
  initPlanPersistence,
} from './persistence'
import { usePlanStore, makeEmptyPlan } from './planStore'
import type { Plan } from '../data/types'

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { for (const k in store) delete store[k] }),
}
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    ...makeEmptyPlan('p1', 'Test Plan', '2.0.0'),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
  usePlanStore.setState({
    plan: makeEmptyPlan('default', 'Default', '2.0.0'),
    undoStack: [],
    redoStack: [],
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// savePlan
// ---------------------------------------------------------------------------

describe('savePlan', () => {
  it('writes the current plan to localStorage', () => {
    usePlanStore.setState({ plan: makePlan({ name: 'Iron Setup' }) })
    savePlan()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      PLAN_STORAGE_KEY,
      expect.stringContaining('"Iron Setup"'),
    )
  })

  it('does not throw when localStorage.setItem throws', () => {
    localStorageMock.setItem.mockImplementationOnce(() => { throw new Error('QuotaExceededError') })
    expect(() => savePlan()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// loadPersistedPlan
// ---------------------------------------------------------------------------

describe('loadPersistedPlan', () => {
  it('returns missing when nothing is stored', () => {
    const result = loadPersistedPlan()
    expect(result).toEqual({ type: 'missing' })
  })

  it('returns ok and restores the plan on valid data', () => {
    const plan = makePlan({ id: 'saved', name: 'Saved Plan' })
    localStorageMock.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan))
    const result = loadPersistedPlan()
    expect(result).toEqual({ type: 'ok' })
    expect(usePlanStore.getState().plan.name).toBe('Saved Plan')
  })

  it('returns error on malformed JSON', () => {
    localStorageMock.setItem(PLAN_STORAGE_KEY, 'not json')
    const result = loadPersistedPlan()
    expect(result.type).toBe('error')
    if (result.type === 'error') {
      expect(result.message).toMatch(/malformed json/i)
    }
  })

  it('returns error on schema validation failure', () => {
    localStorageMock.setItem(PLAN_STORAGE_KEY, JSON.stringify({ id: 123 }))
    const result = loadPersistedPlan()
    expect(result.type).toBe('error')
  })

  it('leaves the plan store unchanged on error', () => {
    const original = usePlanStore.getState().plan
    localStorageMock.setItem(PLAN_STORAGE_KEY, 'bad json')
    loadPersistedPlan()
    expect(usePlanStore.getState().plan).toBe(original)
  })

  it('returns error when localStorage.getItem throws', () => {
    localStorageMock.getItem.mockImplementationOnce(() => { throw new Error('SecurityError') })
    const result = loadPersistedPlan()
    expect(result.type).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// initPlanPersistence
// ---------------------------------------------------------------------------

describe('initPlanPersistence', () => {
  it('auto-saves when the plan changes', () => {
    const unsub = initPlanPersistence()
    usePlanStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    unsub()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      PLAN_STORAGE_KEY,
      expect.stringContaining('iron-plate'),
    )
  })

  it('does not save when only stacks change (not plan)', () => {
    const unsub = initPlanPersistence()
    // Manually change only undoStack without touching the plan reference.
    usePlanStore.setState({ undoStack: [] })
    unsub()
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })

  it('stops auto-saving after unsubscribe', () => {
    const unsub = initPlanPersistence()
    unsub()
    vi.clearAllMocks()
    usePlanStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })
})
