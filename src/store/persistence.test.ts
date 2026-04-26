import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  APP_STATE_STORAGE_KEY,
  saveAppState,
  loadPersistedAppState,
  initAppStatePersistence,
} from './persistence'
import { useBlockStore, makeEmptyBlock } from './blockStore'
import { parseAppState } from '../data/loader'

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
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorageMock.clear()
  vi.clearAllMocks()
  const block = makeEmptyBlock('Default')
  useBlockStore.setState({
    blocks: [block],
    activeBlockId: block.id,
    activeSubPlanId: block.rootPlan.id,
    history: {},
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// saveAppState
// ---------------------------------------------------------------------------

describe('saveAppState', () => {
  it('writes the current app state to localStorage', () => {
    const block = makeEmptyBlock('Iron Setup')
    useBlockStore.setState({ blocks: [block], activeBlockId: block.id, activeSubPlanId: block.rootPlan.id, history: {} })
    saveAppState()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      APP_STATE_STORAGE_KEY,
      expect.stringContaining('"Iron Setup"'),
    )
  })

  it('does not throw when localStorage.setItem throws', () => {
    localStorageMock.setItem.mockImplementationOnce(() => { throw new Error('QuotaExceededError') })
    expect(() => saveAppState()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// loadPersistedAppState
// ---------------------------------------------------------------------------

describe('loadPersistedAppState', () => {
  it('returns missing when nothing is stored', () => {
    const result = loadPersistedAppState()
    expect(result).toEqual({ type: 'missing' })
  })

  it('returns ok and restores the app state on valid data', () => {
    const block = makeEmptyBlock('Saved Plan')
    const appState = { blocks: [block], activeBlockId: block.id }
    localStorageMock.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(appState))
    const result = loadPersistedAppState()
    expect(result).toEqual({ type: 'ok' })
    expect(useBlockStore.getState().blocks[0].name).toBe('Saved Plan')
  })

  it('returns error on malformed JSON', () => {
    localStorageMock.setItem(APP_STATE_STORAGE_KEY, 'not json')
    const result = loadPersistedAppState()
    expect(result.type).toBe('error')
    if (result.type === 'error') {
      expect(result.message).toMatch(/malformed json/i)
    }
  })

  it('returns error on schema validation failure', () => {
    localStorageMock.setItem(APP_STATE_STORAGE_KEY, JSON.stringify({ id: 123 }))
    const result = loadPersistedAppState()
    expect(result.type).toBe('error')
  })

  it('leaves the block store unchanged on error', () => {
    const original = useBlockStore.getState().blocks
    localStorageMock.setItem(APP_STATE_STORAGE_KEY, 'bad json')
    loadPersistedAppState()
    expect(useBlockStore.getState().blocks).toBe(original)
  })

  it('returns error when localStorage.getItem throws', () => {
    localStorageMock.getItem.mockImplementationOnce(() => { throw new Error('SecurityError') })
    const result = loadPersistedAppState()
    expect(result.type).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// initAppStatePersistence
// ---------------------------------------------------------------------------

describe('initAppStatePersistence', () => {
  it('auto-saves when the blocks change', () => {
    const unsub = initAppStatePersistence()
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    unsub()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      APP_STATE_STORAGE_KEY,
      expect.stringContaining('iron-plate'),
    )
  })

  it('does not save when only non-block state changes', () => {
    const unsub = initAppStatePersistence()
    // Change activeSubPlanId (not blocks) — should not trigger a save.
    useBlockStore.setState({ activeSubPlanId: 'some-other-id' })
    unsub()
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })

  it('stops auto-saving after unsubscribe', () => {
    const unsub = initAppStatePersistence()
    unsub()
    vi.clearAllMocks()
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// solverVersion schema
// ---------------------------------------------------------------------------

const minimalRootPlan = {
  id: 'plan-1',
  name: 'Main',
  goals: [],
  nodes: [],
  subPlans: [],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}

function makeAppStateJson(blockOverrides: Record<string, unknown>) {
  const block = {
    id: 'block-1',
    name: 'Test',
    gameDataVersion: '',
    rootPlan: minimalRootPlan,
    ...blockOverrides,
  }
  return JSON.stringify({ blocks: [block], activeBlockId: 'block-1' })
}

describe('solverVersion schema', () => {
  it('a block without solverVersion loads with solverVersion 1', () => {
    const raw = JSON.parse(makeAppStateJson({}))
    const appState = parseAppState(raw)
    expect(appState.blocks[0].solverVersion).toBe(1)
  })

  it('a block with solverVersion 2 round-trips', () => {
    const raw = JSON.parse(makeAppStateJson({ solverVersion: 2 }))
    const appState = parseAppState(raw)
    expect(appState.blocks[0].solverVersion).toBe(2)
  })

  it('solverVersion 0 fails Zod validation', () => {
    const raw = JSON.parse(makeAppStateJson({ solverVersion: 0 }))
    expect(() => parseAppState(raw)).toThrow()
  })

  it('solverVersion 3 fails Zod validation', () => {
    const raw = JSON.parse(makeAppStateJson({ solverVersion: 3 }))
    expect(() => parseAppState(raw)).toThrow()
  })

  it("solverVersion '2' (string) fails Zod validation", () => {
    const raw = JSON.parse(makeAppStateJson({ solverVersion: '2' }))
    expect(() => parseAppState(raw)).toThrow()
  })
})

describe('makeEmptyBlock', () => {
  it('produces solverVersion 2', () => {
    const block = makeEmptyBlock('New Plan')
    expect(block.solverVersion).toBe(2)
  })
})
