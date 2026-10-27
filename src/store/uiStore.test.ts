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
  useUiStore.setState({ rateUnit: 'min', tableView: 'tree', defaultMachinesRequest: null, revealRowRequest: null })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// setRateUnit
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

describe('defaultMachinesRequest', () => {
  it('counts requests up, carrying the category', () => {
    useUiStore.getState().requestDefaultMachines()
    expect(useUiStore.getState().defaultMachinesRequest).toEqual({ seq: 1, category: undefined })
    useUiStore.getState().requestDefaultMachines('crafting')
    expect(useUiStore.getState().defaultMachinesRequest).toEqual({ seq: 2, category: 'crafting' })
  })

  it('clears the request', () => {
    useUiStore.getState().requestDefaultMachines('crafting')
    useUiStore.getState().clearDefaultMachinesRequest()
    expect(useUiStore.getState().defaultMachinesRequest).toBeNull()
  })

  it('is not persisted', () => {
    useUiStore.getState().requestDefaultMachines('crafting')
    saveUiState()
    const written = localStorageMock.setItem.mock.calls.at(-1)?.[1] as string
    expect(Object.keys(JSON.parse(written))).toEqual(['rateUnit', 'tableView'])
  })
})

describe('tableView', () => {
  it('defaults to the tree and can be switched', () => {
    expect(useUiStore.getState().tableView).toBe('tree')
    useUiStore.getState().setTableView('recipe')
    expect(useUiStore.getState().tableView).toBe('recipe')
  })
})

describe('revealRowRequest', () => {
  it('counts requests up, carrying the row id', () => {
    useUiStore.getState().requestRevealRow('a')
    const first = useUiStore.getState().revealRowRequest
    expect(first?.nodeId).toBe('a')
    useUiStore.getState().requestRevealRow('b')
    expect(useUiStore.getState().revealRowRequest).toEqual({ seq: (first?.seq ?? 0) + 1, nodeId: 'b' })
  })

  it('is not persisted', () => {
    useUiStore.getState().requestRevealRow('a')
    saveUiState()
    const written = localStorageMock.setItem.mock.calls.at(-1)?.[1] as string
    expect(Object.keys(JSON.parse(written))).toEqual(['rateUnit', 'tableView'])
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

  it('restores tableView from localStorage', () => {
    localStorageMock.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({ rateUnit: 'min', tableView: 'recipe' }))
    loadPersistedUiState()
    expect(useUiStore.getState().tableView).toBe('recipe')
  })

  it('ignores unknown tableView values', () => {
    localStorageMock.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({ rateUnit: 'sec', tableView: 'grid' }))
    loadPersistedUiState()
    expect(useUiStore.getState().tableView).toBe('tree')
    expect(useUiStore.getState().rateUnit).toBe('sec')
  })

  it('loads state saved before tableView existed', () => {
    localStorageMock.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({ rateUnit: 'sec' }))
    loadPersistedUiState()
    expect(useUiStore.getState().rateUnit).toBe('sec')
    expect(useUiStore.getState().tableView).toBe('tree')
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

  it('auto-saves when tableView changes', () => {
    const unsub = initUiStatePersistence()
    useUiStore.getState().setTableView('recipe')
    unsub()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      UI_STATE_STORAGE_KEY,
      expect.stringContaining('"tableView":"recipe"'),
    )
  })

  it('stops auto-saving after unsubscribe', () => {
    const unsub = initUiStatePersistence()
    unsub()
    vi.clearAllMocks()
    useUiStore.getState().setRateUnit('sec')
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })
})
