import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  UI_STATE_STORAGE_KEY,
  useUiStore,
  saveUiState,
  loadPersistedUiState,
  initUiStatePersistence,
} from './uiStore'

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
  useUiStore.setState({ rateUnit: 'min', activeFloorPath: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

describe('setRateUnit', () => {
  it('changes rateUnit to sec', () => {
    useUiStore.getState().setRateUnit('sec')
    expect(useUiStore.getState().rateUnit).toBe('sec')
  })

  it('changes rateUnit to min', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    useUiStore.getState().setRateUnit('min')
    expect(useUiStore.getState().rateUnit).toBe('min')
  })
})

describe('pushFloor', () => {
  it('appends a subplan id to the path', () => {
    useUiStore.getState().pushFloor('sp-1')
    expect(useUiStore.getState().activeFloorPath).toEqual(['sp-1'])
  })

  it('stacks multiple pushes', () => {
    useUiStore.getState().pushFloor('sp-1')
    useUiStore.getState().pushFloor('sp-2')
    expect(useUiStore.getState().activeFloorPath).toEqual(['sp-1', 'sp-2'])
  })
})

describe('popFloor', () => {
  it('removes the last id from the path', () => {
    useUiStore.setState({ activeFloorPath: ['sp-1', 'sp-2'] })
    useUiStore.getState().popFloor()
    expect(useUiStore.getState().activeFloorPath).toEqual(['sp-1'])
  })

  it('is a no-op on an empty path', () => {
    useUiStore.getState().popFloor()
    expect(useUiStore.getState().activeFloorPath).toEqual([])
  })
})

describe('resetFloor', () => {
  it('clears the path', () => {
    useUiStore.setState({ activeFloorPath: ['sp-1', 'sp-2', 'sp-3'] })
    useUiStore.getState().resetFloor()
    expect(useUiStore.getState().activeFloorPath).toEqual([])
  })
})

describe('setFloorPath', () => {
  it('replaces the path', () => {
    useUiStore.setState({ activeFloorPath: ['sp-1'] })
    useUiStore.getState().setFloorPath(['sp-a', 'sp-b'])
    expect(useUiStore.getState().activeFloorPath).toEqual(['sp-a', 'sp-b'])
  })

  it('can set an empty path', () => {
    useUiStore.setState({ activeFloorPath: ['sp-1'] })
    useUiStore.getState().setFloorPath([])
    expect(useUiStore.getState().activeFloorPath).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('saveUiState', () => {
  it('writes rateUnit to localStorage', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    saveUiState()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      UI_STATE_STORAGE_KEY,
      expect.stringContaining('"sec"'),
    )
  })

  it('does not throw when localStorage.setItem throws', () => {
    localStorageMock.setItem.mockImplementationOnce(() => { throw new Error('QuotaExceededError') })
    expect(() => saveUiState()).not.toThrow()
  })
})

describe('loadPersistedUiState', () => {
  it('restores rateUnit from localStorage', () => {
    localStorageMock.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({ rateUnit: 'sec' }))
    loadPersistedUiState()
    expect(useUiStore.getState().rateUnit).toBe('sec')
  })

  it('ignores missing entry', () => {
    loadPersistedUiState()
    expect(useUiStore.getState().rateUnit).toBe('min')
  })

  it('ignores malformed JSON', () => {
    localStorageMock.setItem(UI_STATE_STORAGE_KEY, 'not json')
    expect(() => loadPersistedUiState()).not.toThrow()
    expect(useUiStore.getState().rateUnit).toBe('min')
  })

  it('ignores unknown rateUnit values', () => {
    localStorageMock.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({ rateUnit: 'hour' }))
    loadPersistedUiState()
    expect(useUiStore.getState().rateUnit).toBe('min')
  })

  it('does not restore activeFloorPath (session-only)', () => {
    localStorageMock.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({ rateUnit: 'sec', activeFloorPath: ['sp-1'] }))
    loadPersistedUiState()
    expect(useUiStore.getState().activeFloorPath).toEqual([])
  })
})

describe('initUiStatePersistence', () => {
  it('auto-saves when rateUnit changes', () => {
    const unsub = initUiStatePersistence()
    useUiStore.getState().setRateUnit('sec')
    unsub()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      UI_STATE_STORAGE_KEY,
      expect.stringContaining('"sec"'),
    )
  })

  it('does not save when only activeFloorPath changes', () => {
    const unsub = initUiStatePersistence()
    useUiStore.getState().pushFloor('sp-1')
    unsub()
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })

  it('stops auto-saving after unsubscribe', () => {
    const unsub = initUiStatePersistence()
    unsub()
    vi.clearAllMocks()
    useUiStore.getState().setRateUnit('sec')
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })
})
