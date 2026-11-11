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
  useUiStore.setState({ rateUnit: 'min', bridgeUrl: 'ws://127.0.0.1:34199/', viewerAutoSend: false, summaryCollapsed: true, defaultMachinesRequest: null, revealRowRequest: null })
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

describe('summaryCollapsed', () => {
  it('is saved when it changes', () => {
    useUiStore.getState().setSummaryCollapsed(false)
    saveUiState()
    const written = localStorageMock.setItem.mock.calls.at(-1)?.[1] as string
    expect(JSON.parse(written).summaryCollapsed).toBe(false)
  })
})

describe('summaryCollapsed', () => {
  it('starts collapsed and is saved when it changes', () => {
    expect(useUiStore.getState().summaryCollapsed).toBe(true)
    const unsub = initUiStatePersistence()
    useUiStore.getState().setSummaryCollapsed(false)
    unsub()
    const written = localStorageMock.setItem.mock.calls.at(-1)?.[1] as string
    expect(JSON.parse(written).summaryCollapsed).toBe(false)
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
    expect(Object.keys(JSON.parse(written))).toEqual(['rateUnit', 'bridgeUrl', 'viewerAutoSend', 'summaryCollapsed'])
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
    expect(Object.keys(JSON.parse(written))).toEqual(['rateUnit', 'bridgeUrl', 'viewerAutoSend', 'summaryCollapsed'])
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

  it('restores the in-game viewer settings, and defaults without them', () => {
    expect(useUiStore.getState().bridgeUrl).toBe('ws://127.0.0.1:34199/')
    localStorageMock.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({ bridgeUrl: 'ws://127.0.0.1:40000/', viewerAutoSend: true }))
    loadPersistedUiState()
    expect(useUiStore.getState().bridgeUrl).toBe('ws://127.0.0.1:40000/')
    expect(useUiStore.getState().viewerAutoSend).toBe(true)
  })

  it('restores the summary strip choice; the summary starts collapsed without one', () => {
    expect(useUiStore.getState().summaryCollapsed).toBe(true)
    localStorageMock.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({ summaryCollapsed: false }))
    loadPersistedUiState()
    expect(useUiStore.getState().summaryCollapsed).toBe(false)
  })

  it('ignores a tableView left by an older version', () => {
    localStorageMock.setItem(UI_STATE_STORAGE_KEY, JSON.stringify({ rateUnit: 'sec', tableView: 'recipe' }))
    loadPersistedUiState()
    expect(useUiStore.getState().rateUnit).toBe('sec')
    expect('tableView' in useUiStore.getState()).toBe(false)
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

  it('stops auto-saving after unsubscribe', () => {
    const unsub = initUiStatePersistence()
    unsub()
    vi.clearAllMocks()
    useUiStore.getState().setRateUnit('sec')
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })
})

describe('ingredient slot request', () => {
  beforeEach(() => useUiStore.setState({ ingredientSlotRequest: null }))

  it('names the item, with a new seq on every call (the same item twice is two requests)', () => {
    useUiStore.getState().openIngredientSlot('iron-ore')
    const first = useUiStore.getState().ingredientSlotRequest
    expect(first).toMatchObject({ itemId: 'iron-ore' })
    useUiStore.getState().openIngredientSlot('iron-ore')
    const second = useUiStore.getState().ingredientSlotRequest
    expect(second?.itemId).toBe('iron-ore')
    expect(second?.seq).not.toBe(first?.seq)
  })

  it('is cleared by its own seq only, so a consumer never drops a newer request', () => {
    useUiStore.getState().openIngredientSlot('iron-ore')
    const stale = useUiStore.getState().ingredientSlotRequest!.seq
    useUiStore.getState().openIngredientSlot('slag')
    useUiStore.getState().clearIngredientSlotRequest(stale)
    expect(useUiStore.getState().ingredientSlotRequest).toMatchObject({ itemId: 'slag' })
    useUiStore.getState().clearIngredientSlotRequest(useUiStore.getState().ingredientSlotRequest!.seq)
    expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
  })

  it('touches nothing else: expanding the summary and closing a drawer are the consumer\'s', () => {
    useUiStore.setState({ summaryCollapsed: true, selectedRow: { blockId: 'b1', nodeId: 'n1' } })
    useUiStore.getState().openIngredientSlot('iron-ore')
    expect(useUiStore.getState().summaryCollapsed).toBe(true)
    expect(useUiStore.getState().selectedRow).toEqual({ blockId: 'b1', nodeId: 'n1' })
  })

  it('is not persisted', () => {
    const unsub = initUiStatePersistence()
    vi.clearAllMocks()
    useUiStore.getState().openIngredientSlot('iron-ore')
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
    unsub()
  })
})

describe('panel highlight', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUiStore.setState({ selectedRow: null, panelHighlight: null })
  })
  afterEach(() => { vi.useRealTimers() })

  it('belongs to the row that asked for it', () => {
    useUiStore.getState().selectRowSection('b1', 'n1', 'beacons')
    expect(useUiStore.getState().panelHighlight).toMatchObject({ blockId: 'b1', nodeId: 'n1', section: 'beacons' })
  })

  it('is dropped when another row is selected, and when the selection clears', () => {
    useUiStore.getState().selectRowSection('b1', 'n1', 'machine')
    useUiStore.getState().selectRow('b1', 'n2')
    expect(useUiStore.getState().panelHighlight).toBeNull()
    useUiStore.getState().selectRowSection('b1', 'n2', 'machine')
    useUiStore.getState().clearSelectedRow()
    expect(useUiStore.getState().panelHighlight).toBeNull()
  })

  it('expires on its own even when no section shows it', () => {
    useUiStore.getState().selectRowSection('b1', 'n1', 'beacons')
    vi.advanceTimersByTime(5000)
    expect(useUiStore.getState().panelHighlight).toBeNull()
  })
})
