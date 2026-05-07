import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  APP_STATE_STORAGE_KEY,
  saveAppState,
  loadPersistedAppState,
  initAppStatePersistence,
} from './persistence'
import { useBlockStore, makeEmptyBlock } from './blockStore'

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
    useBlockStore.setState({ blocks: [block], activeBlockId: block.id, history: {} })
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
    // Change history (not blocks) — should not trigger a save.
    useBlockStore.setState({ history: { 'some-id': { undoStack: [], redoStack: [] } } })
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

describe('makeEmptyBlock', () => {
  it('produces a block with a root plan', () => {
    const block = makeEmptyBlock('New Plan')
    expect(block.rootPlan).toBeDefined()
    expect(block.name).toBe('New Plan')
  })
})
