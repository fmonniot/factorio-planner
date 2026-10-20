import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  LEGACY_APP_STATE_STORAGE_KEY,
  planStorageKey,
  saveAppState,
  loadPersistedAppState,
  activatePlan,
  initAppStatePersistence,
  removeCustomPlans,
  checkPlanImport,
  findUnknownPlanIds,
  replacePlan,
} from './persistence'
import { useBlockStore, makeEmptyBlock } from './blockStore'
import { HEX_COLOR_RE } from '../data/blockColors'
import { useGameDataStore } from './gameDataStore'
import type { AppState, GameData, Block, GameRecipeNode } from '../data/types'

const KEY = planStorageKey('nullius')

function loadedStatus(sourceId: string) {
  return { type: 'loaded' as const, gameData: {} as unknown as GameData, sourceId }
}

function storePlan(sourceId: string, name: string) {
  const block = makeEmptyBlock(name)
  localStorageMock.setItem(planStorageKey(sourceId), JSON.stringify({ blocks: [block], activeBlockId: block.id }))
}

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { for (const k in store) delete store[k] }),
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  get length() { return Object.keys(store).length },
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
    horizonTechnologyIds: [],
    history: {},
  })
  useGameDataStore.setState({ status: { type: 'empty' } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// saveAppState
// ---------------------------------------------------------------------------

describe('saveAppState', () => {
  it('writes the current app state under the active data set key', () => {
    const unsub = initAppStatePersistence()
    activatePlan('nullius')
    vi.clearAllMocks()
    const block = makeEmptyBlock('Iron Setup')
    useBlockStore.setState({ blocks: [block], activeBlockId: block.id, history: {} })
    saveAppState()
    unsub()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      KEY,
      expect.stringContaining('"Iron Setup"'),
    )
  })

  it('is a no-op while no data set is active', () => {
    saveAppState()
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })

  it('does not throw when localStorage.setItem throws', () => {
    const unsub = initAppStatePersistence()
    activatePlan('nullius')
    unsub()
    localStorageMock.setItem.mockImplementationOnce(() => { throw new Error('QuotaExceededError') })
    activatePlan('nullius')
    expect(() => saveAppState()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// loadPersistedAppState
// ---------------------------------------------------------------------------

describe('loadPersistedAppState', () => {
  it('returns missing when nothing is stored', () => {
    const result = loadPersistedAppState('nullius')
    expect(result).toEqual({ type: 'missing' })
  })

  it('returns ok and restores the app state on valid data', () => {
    const block = makeEmptyBlock('Saved Plan')
    const appState = { blocks: [block], activeBlockId: block.id }
    localStorageMock.setItem(KEY, JSON.stringify(appState))
    const result = loadPersistedAppState('nullius')
    expect(result).toEqual({ type: 'ok' })
    expect(useBlockStore.getState().blocks[0].name).toBe('Saved Plan')
  })

  it('returns error on malformed JSON', () => {
    localStorageMock.setItem(KEY, 'not json')
    const result = loadPersistedAppState('nullius')
    expect(result.type).toBe('error')
    if (result.type === 'error') {
      expect(result.message).toMatch(/malformed json/i)
    }
  })

  it('returns error on schema validation failure', () => {
    localStorageMock.setItem(KEY, JSON.stringify({ id: 123 }))
    const result = loadPersistedAppState('nullius')
    expect(result.type).toBe('error')
  })

  it('leaves the block store unchanged on error', () => {
    const original = useBlockStore.getState().blocks
    localStorageMock.setItem(KEY, 'bad json')
    loadPersistedAppState('nullius')
    expect(useBlockStore.getState().blocks).toBe(original)
  })

  it('returns error when localStorage.getItem throws', () => {
    localStorageMock.getItem.mockImplementationOnce(() => { throw new Error('SecurityError') })
    const result = loadPersistedAppState('nullius')
    expect(result.type).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// initAppStatePersistence
// ---------------------------------------------------------------------------

describe('initAppStatePersistence', () => {
  it('auto-saves when the blocks change', () => {
    const unsub = initAppStatePersistence()
    activatePlan('nullius')
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    unsub()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      KEY,
      expect.stringContaining('iron-plate'),
    )
  })

  it('does not save when only non-block state changes', () => {
    const unsub = initAppStatePersistence()
    activatePlan('nullius')
    vi.clearAllMocks()
    // Change history (not blocks) — should not trigger a save.
    useBlockStore.setState({ history: { 'some-id': { undoStack: [], redoStack: [] } } })
    unsub()
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })

  it('stops auto-saving after unsubscribe', () => {
    const unsub = initAppStatePersistence()
    activatePlan('nullius')
    unsub()
    vi.clearAllMocks()
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })

  it('does not save while no data set has loaded', () => {
    const unsub = initAppStatePersistence()
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    unsub()
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Per-data-set plans
// ---------------------------------------------------------------------------

describe('planStorageKey', () => {
  it('ignores trailing slashes in the source id', () => {
    expect(planStorageKey('kompetenz-seablock/')).toBe(planStorageKey('kompetenz-seablock'))
  })

  it('differs per source', () => {
    expect(planStorageKey('nullius')).not.toBe(planStorageKey('custom:a.json'))
  })
})

describe('switching data sets', () => {
  let unsub: () => void
  beforeEach(() => { unsub = initAppStatePersistence() })
  afterEach(() => { unsub() })

  it('swaps in the plan stored for the newly loaded data set', () => {
    storePlan('nullius', 'Nullius plan')
    storePlan('seablock', 'Seablock plan')
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(useBlockStore.getState().blocks[0].name).toBe('Nullius plan')
    useGameDataStore.setState({ status: loadedStatus('seablock') })
    expect(useBlockStore.getState().blocks[0].name).toBe('Seablock plan')
  })

  it('starts a data set without a stored plan empty', () => {
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    useGameDataStore.setState({ status: loadedStatus('seablock') })
    const { blocks } = useBlockStore.getState()
    expect(blocks).toHaveLength(1)
    expect(blocks[0].goals, 'goals of the old data set must not leak').toEqual([])
  })

  it('does not overwrite the old plan when switching', () => {
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    useGameDataStore.setState({ status: loadedStatus('seablock') })
    expect(store[planStorageKey('nullius')]).toContain('iron-plate')
    expect(store[planStorageKey('seablock')]).not.toContain('iron-plate')
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(useBlockStore.getState().blocks[0].goals[0]?.itemId).toBe('iron-plate')
  })

  it('does not reset the plan when the same data set loads again', () => {
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(useBlockStore.getState().blocks[0].goals).toHaveLength(1)
  })

  it('leaves the plan alone when loading fails', () => {
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    useGameDataStore.setState({ status: { type: 'error', message: 'boom' } })
    expect(useBlockStore.getState().blocks[0].goals).toHaveLength(1)
    useBlockStore.getState().addGoal({ id: 'g2', itemId: 'copper-plate', rate: 60 })
    expect(store[KEY]).toContain('copper-plate')
  })

  it('starts empty when the stored plan is unreadable', () => {
    localStorageMock.setItem(planStorageKey('seablock'), 'not json')
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    useGameDataStore.setState({ status: loadedStatus('seablock') })
    expect(useBlockStore.getState().blocks[0].goals).toEqual([])
  })

  it('keeps an unreadable stored plan under :corrupt instead of overwriting it', () => {
    localStorageMock.setItem(planStorageKey('seablock'), 'not json')
    useGameDataStore.setState({ status: loadedStatus('seablock') })
    expect(store[planStorageKey('seablock') + ':corrupt'], 'raw value is recoverable').toBe('not json')
    useBlockStore.getState().addGoal({ id: 'g1', itemId: 'iron-plate', rate: 60 })
    expect(store[planStorageKey('seablock') + ':corrupt']).toBe('not json')
    expect(store[planStorageKey('seablock')]).toContain('iron-plate')
  })
})

describe('research horizon', () => {
  let unsub: () => void
  beforeEach(() => { unsub = initAppStatePersistence() })
  afterEach(() => { unsub() })

  it('autosaves when only the horizon changes', () => {
    activatePlan('nullius')
    vi.clearAllMocks()
    useBlockStore.getState().setHorizonTechnologyIds(['x'])
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      KEY,
      expect.stringContaining('"horizonTechnologyIds":["x"]'),
    )
  })

  it('restores a stored horizon on activation', () => {
    const block = makeEmptyBlock('Stored')
    localStorageMock.setItem(KEY, JSON.stringify({ blocks: [block], activeBlockId: block.id, horizonTechnologyIds: ['y'] }))
    activatePlan('nullius')
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual(['y'])
  })

  it('resets the horizon when the stored plan is corrupt', () => {
    useBlockStore.getState().setHorizonTechnologyIds(['z'])
    localStorageMock.setItem(KEY, 'not json')
    activatePlan('nullius')
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual([])
  })
})

describe('custom plans', () => {
  let unsub: () => void
  beforeEach(() => { unsub = initAppStatePersistence() })
  afterEach(() => { unsub() })

  it('removeCustomPlans drops custom plans but keeps bundled ones and the excepted key', () => {
    storePlan('nullius', 'N')
    storePlan('custom:a.json#1', 'A')
    storePlan('custom:b.json#2', 'B')
    removeCustomPlans(planStorageKey('custom:b.json#2'))
    expect(store[planStorageKey('nullius')]).toBeDefined()
    expect(store[planStorageKey('custom:a.json#1')]).toBeUndefined()
    expect(store[planStorageKey('custom:b.json#2')]).toBeDefined()
    removeCustomPlans()
    expect(store[planStorageKey('custom:b.json#2')]).toBeUndefined()
  })

  it('activating a new upload drops the plan of the replaced one', () => {
    storePlan('custom:a.json#1', 'A')
    useGameDataStore.setState({ status: loadedStatus('custom:b.json#2') })
    expect(store[planStorageKey('custom:a.json#1')]).toBeUndefined()
  })
})

describe('legacy plan migration', () => {
  it('adopts the legacy plan for the first data set loaded and deletes the legacy key', () => {
    const unsub = initAppStatePersistence()
    const block = makeEmptyBlock('Legacy plan')
    localStorageMock.setItem(LEGACY_APP_STATE_STORAGE_KEY, JSON.stringify({ blocks: [block], activeBlockId: block.id }))
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(useBlockStore.getState().blocks[0].name).toBe('Legacy plan')
    expect(store[LEGACY_APP_STATE_STORAGE_KEY]).toBeUndefined()
    expect(store[KEY]).toContain('Legacy plan')
    unsub()
  })

  it('does not touch the legacy plan when the data set already has one', () => {
    const unsub = initAppStatePersistence()
    storePlan('nullius', 'Own plan')
    localStorageMock.setItem(LEGACY_APP_STATE_STORAGE_KEY, JSON.stringify({ blocks: [makeEmptyBlock('Legacy plan')], activeBlockId: 'x' }))
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(useBlockStore.getState().blocks[0].name).toBe('Own plan')
    expect(store[LEGACY_APP_STATE_STORAGE_KEY]).toBeDefined()
    unsub()
  })

  it('moves an unreadable legacy plan to :corrupt instead of deleting it', () => {
    const unsub = initAppStatePersistence()
    localStorageMock.setItem(LEGACY_APP_STATE_STORAGE_KEY, 'not json')
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(store[LEGACY_APP_STATE_STORAGE_KEY]).toBeUndefined()
    expect(store[LEGACY_APP_STATE_STORAGE_KEY + ':corrupt']).toBe('not json')
    expect(useBlockStore.getState().blocks[0].goals).toEqual([])
    unsub()
  })
})

describe('makeEmptyBlock', () => {
  it('produces a block with a root plan', () => {
    const block = makeEmptyBlock('New Plan')
    expect(block.rootPlan).toBeDefined()
    expect(block.name).toBe('New Plan')
  })
})

// ---------------------------------------------------------------------------
// plan import
// ---------------------------------------------------------------------------

describe('plan import', () => {
  const parseRoundTrip = (state: AppState) => JSON.parse(JSON.stringify(state)) as AppState
  const now = '2026-01-01T00:00:00.000Z'

  function recipeNode(id: string, recipeId: string): GameRecipeNode {
    return { kind: 'game-recipe', id, recipeId, modules: [], byproductPolicy: {} }
  }

  function makeBlock(id: string, opts: { goal?: string; recipes?: string[]; nested?: string[] } = {}): Block {
    const block = makeEmptyBlock(id)
    block.id = id
    if (opts.goal) block.goals = [{ id: `${id}-g`, itemId: opts.goal, rate: 60 }]
    block.rootPlan.nodes = (opts.recipes ?? []).map((r, i) => recipeNode(`${id}-n${i}`, r))
    if (opts.nested) {
      block.rootPlan.subPlans = [{
        id: `${id}-sp`, name: 'Sub', nodes: opts.nested.map((r, i) => recipeNode(`${id}-s${i}`, r)),
        subPlans: [], createdAt: now, updatedAt: now,
      }]
    }
    return block
  }

  function makeState(activeBlockId = 'b1'): AppState {
    return {
      blocks: [makeBlock('b1', { goal: 'iron-plate', recipes: ['iron-plate'] }), makeBlock('b2')],
      activeBlockId,
      horizonTechnologyIds: ['electronics'],
    }
  }

  function gameDataWith(recipes: string[], items: string[]): GameData {
    return {
      recipes: Object.fromEntries(recipes.map(r => [r, {}])),
      items: Object.fromEntries(items.map(i => [i, {}])),
    } as unknown as GameData
  }

  const knownData = () => gameDataWith(['iron-plate'], ['iron-plate'])

  describe('checkPlanImport', () => {
    it('accepts a valid plan without touching the store', () => {
      const before = useBlockStore.getState().blocks
      const input = makeState()
      const result = checkPlanImport(JSON.stringify(input), knownData(), 'nullius')
      expect(result.type).toBe('ok')
      if (result.type !== 'ok') return
      expect(result.appState).toEqual(parseRoundTrip(input))
      expect(result.unknownIds).toEqual([])
      expect(useBlockStore.getState().blocks).toBe(before)
    })

    it('rejects malformed JSON without touching the store', () => {
      const before = useBlockStore.getState().blocks
      const result = checkPlanImport('{', knownData(), 'nullius')
      expect(result.type).toBe('error')
      if (result.type === 'error') expect(result.message).toMatch(/^Not a valid JSON file:/)
      expect(useBlockStore.getState().blocks).toBe(before)
    })

    it('rejects JSON that fails the schema', () => {
      const result = checkPlanImport('{"blocks": 5}', knownData(), 'nullius')
      expect(result.type).toBe('error')
      if (result.type === 'error') expect(result.message).toContain('blocks')
    })

    it('rejects a plan with no blocks', () => {
      expect(checkPlanImport('{"blocks": [], "activeBlockId": "x"}', knownData(), 'nullius'))
        .toEqual({ type: 'error', message: 'The plan contains no blocks.' })
    })

    it('falls back to the first block when the active id matches none', () => {
      const result = checkPlanImport(JSON.stringify(makeState('nope')), knownData(), 'nullius')
      expect(result.type).toBe('ok')
      if (result.type === 'ok') expect(result.appState.activeBlockId).toBe(result.appState.blocks[0].id)
    })

    it('rejects duplicate block ids', () => {
      const state = { ...makeState(), blocks: [makeBlock('b1'), makeBlock('b1')] }
      expect(checkPlanImport(JSON.stringify(state), knownData(), 'nullius'))
        .toEqual({ type: 'error', message: 'Duplicate block id "b1".' })
    })

    it('rejects duplicate node ids within a block', () => {
      const block = makeBlock('b1', { recipes: ['iron-plate'], nested: ['iron-plate'] })
      block.rootPlan.subPlans[0].nodes[0].id = block.rootPlan.nodes[0].id
      const result = checkPlanImport(JSON.stringify({ ...makeState(), blocks: [block] }), knownData(), 'nullius')
      expect(result).toEqual({ type: 'error', message: `Duplicate node id "${block.rootPlan.nodes[0].id}" in block "b1".` })
    })

    it('rejects duplicate sub-plan ids within a block', () => {
      const block = makeBlock('b1', { nested: [] })
      block.rootPlan.subPlans.push({ ...block.rootPlan.subPlans[0] })
      const result = checkPlanImport(JSON.stringify({ ...makeState(), blocks: [block] }), knownData(), 'nullius')
      expect(result).toEqual({ type: 'error', message: 'Duplicate sub-plan id "b1-sp" in block "b1".' })
    })

    it('carries the source id it was checked against', () => {
      const result = checkPlanImport(JSON.stringify(makeState()), knownData(), 'seablock')
      expect(result.type === 'ok' && result.sourceId).toBe('seablock')
    })

    it('accepts a legacy block with per-subplan goals', () => {
      const legacy = {
        id: 'b1', name: 'Block', noImportItems: [],
        rootPlan: {
          id: 'root', name: 'Main', nodes: [], subPlans: [], createdAt: now, updatedAt: now,
          goals: [{ id: 'g', itemId: 'iron-plate', rate: 60 }],
        },
      }
      const result = checkPlanImport(JSON.stringify({ blocks: [legacy], activeBlockId: 'b1' }), knownData(), 'nullius')
      expect(result.type).toBe('ok')
      expect(result.type === 'ok' && result.appState.blocks[0].color).toMatch(HEX_COLOR_RE)
    })
  })

  describe('findUnknownPlanIds', () => {
    it('reports a recipe nested in a subplan', () => {
      const state = { ...makeState(), blocks: [makeBlock('b1', { nested: ['ghost'] })] }
      expect(findUnknownPlanIds(state, knownData())).toEqual(['ghost'])
    })

    it('reports an unknown goal item', () => {
      const state = { ...makeState(), blocks: [makeBlock('b1', { goal: 'nope-item' })] }
      expect(findUnknownPlanIds(state, knownData())).toEqual(['nope-item'])
    })

    it('reports a repeated id once and skips known ids', () => {
      const state = {
        ...makeState(),
        blocks: [makeBlock('b1', { recipes: ['ghost', 'iron-plate'], nested: ['ghost'] }), makeBlock('b2', { recipes: ['ghost'] })],
      }
      expect(findUnknownPlanIds(state, knownData())).toEqual(['ghost'])
    })
  })

  describe('replacePlan', () => {
    it('refuses while no game data is loaded and leaves the store unchanged', () => {
      const before = useBlockStore.getState().blocks
      const result = replacePlan(makeState(), 'nullius')
      expect(result).toEqual({ type: 'error', message: 'Load game data before importing a plan.' })
      expect(useBlockStore.getState().blocks).toBe(before)
    })

    it('refuses when the loaded game data changed since the check', () => {
      useGameDataStore.setState({ status: loadedStatus('seablock') })
      const before = useBlockStore.getState().blocks
      expect(replacePlan(makeState(), 'nullius'))
        .toEqual({ type: 'error', message: 'The loaded game data changed; pick the file again.' })
      expect(useBlockStore.getState().blocks).toBe(before)
    })

    it('replaces the plan, clears history and autosaves it', () => {
      const unsub = initAppStatePersistence()
      try {
        useGameDataStore.setState({ status: loadedStatus('nullius') })
        vi.clearAllMocks()
        const imported = makeState('b2')
        expect(replacePlan(imported, 'nullius')).toEqual({ type: 'ok' })
        const state = useBlockStore.getState()
        expect(state.blocks).toEqual(imported.blocks)
        expect(state.activeBlockId).toBe('b2')
        expect(state.horizonTechnologyIds).toEqual(['electronics'])
        expect(state.history).toEqual({})
        expect(localStorageMock.setItem).toHaveBeenCalledWith(KEY, JSON.stringify(imported))
      } finally {
        unsub()
      }
    })
  })
})
