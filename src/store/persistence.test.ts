import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  LEGACY_APP_STATE_STORAGE_KEY,
  saveAppState,
  activateDataSet,
  initAppStatePersistence,
  removeCustomPlans,
  checkPlanImport,
  findUnknownPlanIds,
  importPlanAsNew,
  switchPlan,
  createPlan,
  duplicatePlan,
  renamePlan,
  deletePlan,
  nextPlanName,
  planNameFromFileName,
  exportFileName,
  exportPlanJson,
  makeDataSetStamp,
  dataSetMismatchMessage,
} from './persistence'
import { useBlockStore, makeEmptyBlock, selectAppState } from './blockStore'
import { parseAppState } from '../data/loader'
import { usePlansStore } from './plansStore'
import { legacyPlanStorageKey, planIndexKey, planKey } from './sourceId'
import { HEX_COLOR_RE } from '../data/blockColors'
import { useGameDataStore } from './gameDataStore'
import type { AppState, GameData, Block, GameRecipeNode, PlanIndex } from '../data/types'

/** Parsed plan index stored for a data set; throws when there is none. */
function readIndex(sourceId: string): PlanIndex {
  return JSON.parse(store[planIndexKey(sourceId)]) as PlanIndex
}

/** Storage key of the active plan of a data set. */
function activePlanKey(sourceId: string): string {
  return planKey(sourceId, readIndex(sourceId).activePlanId)
}

const KEY = () => activePlanKey('nullius')

function loadedStatus(sourceId: string) {
  return { type: 'loaded' as const, gameData: {} as unknown as GameData, sourceId }
}

function storePlan(sourceId: string, name: string) {
  const block = makeEmptyBlock(name)
  localStorageMock.setItem(legacyPlanStorageKey(sourceId), JSON.stringify({ blocks: [block], activeBlockId: block.id }))
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
    defaultMachineOverrides: {},
    history: {},
  })
  useGameDataStore.setState({ status: { type: 'empty' } })
  usePlansStore.setState({ sourceId: null, index: null })
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
    activateDataSet('nullius')
    vi.clearAllMocks()
    const block = makeEmptyBlock('Iron Setup')
    useBlockStore.setState({ blocks: [block], activeBlockId: block.id, history: {} })
    saveAppState()
    unsub()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      KEY(),
      expect.stringContaining('"Iron Setup"'),
    )
  })

  it('is a no-op while no data set is active', () => {
    saveAppState()
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })

  it('does not throw when localStorage.setItem throws', () => {
    const unsub = initAppStatePersistence()
    activateDataSet('nullius')
    unsub()
    localStorageMock.setItem.mockImplementationOnce(() => { throw new Error('QuotaExceededError') })
    activateDataSet('nullius')
    expect(() => saveAppState()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// initAppStatePersistence
// ---------------------------------------------------------------------------

describe('initAppStatePersistence', () => {
  it('auto-saves when the blocks change', () => {
    const unsub = initAppStatePersistence()
    activateDataSet('nullius')
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    unsub()
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      KEY(),
      expect.stringContaining('iron-plate'),
    )
  })

  it('does not save when only non-block state changes', () => {
    const unsub = initAppStatePersistence()
    activateDataSet('nullius')
    vi.clearAllMocks()
    // Change history (not blocks) — should not trigger a save.
    useBlockStore.setState({ history: { 'some-id': { undoStack: [], redoStack: [] } } })
    unsub()
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })

  it('stops auto-saving after unsubscribe', () => {
    const unsub = initAppStatePersistence()
    activateDataSet('nullius')
    unsub()
    vi.clearAllMocks()
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })

  it('does not save while no data set has loaded', () => {
    const unsub = initAppStatePersistence()
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    unsub()
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Per-data-set plans
// ---------------------------------------------------------------------------

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
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    useGameDataStore.setState({ status: loadedStatus('seablock') })
    const { blocks } = useBlockStore.getState()
    expect(blocks).toHaveLength(1)
    expect(blocks[0].products, 'products of the old data set must not leak').toEqual([])
  })

  it('does not overwrite the old plan when switching', () => {
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    useGameDataStore.setState({ status: loadedStatus('seablock') })
    expect(store[activePlanKey('nullius')]).toContain('iron-plate')
    expect(store[activePlanKey('seablock')]).not.toContain('iron-plate')
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(useBlockStore.getState().blocks[0].products[0]?.itemId).toBe('iron-plate')
  })

  it('does not reset the plan when the same data set loads again', () => {
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(useBlockStore.getState().blocks[0].products).toHaveLength(1)
  })

  it('loads a stored plan with block-level goals as products and saves it in the new shape', () => {
    const block = { ...makeEmptyBlock('Legacy'), products: undefined, goals: [{ id: 'g1', itemId: 'iron-plate', rate: 60 }] }
    localStorageMock.setItem(legacyPlanStorageKey('nullius'), JSON.stringify({ blocks: [block], activeBlockId: block.id }))
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(useBlockStore.getState().blocks[0].products).toEqual([{ id: 'g1', itemId: 'iron-plate', extraRate: 60 }])
    useBlockStore.getState().toggleNoImportItem('benzene') // any change triggers a save
    const saved = JSON.parse(store[KEY()])
    expect(saved.blocks[0].products).toEqual([{ id: 'g1', itemId: 'iron-plate', extraRate: 60 }])
    expect(saved.blocks[0], 'saved block has no legacy goals').not.toHaveProperty('goals')
  })

  it('leaves the plan alone when loading fails', () => {
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    useGameDataStore.setState({ status: { type: 'error', message: 'boom' } })
    expect(useBlockStore.getState().blocks[0].products).toHaveLength(1)
    useBlockStore.getState().addProduct({ id: 'g2', itemId: 'copper-plate', extraRate: 60 })
    expect(store[KEY()]).toContain('copper-plate')
  })

  it('starts empty when the stored plan is unreadable', () => {
    localStorageMock.setItem(legacyPlanStorageKey('seablock'), 'not json')
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    useGameDataStore.setState({ status: loadedStatus('seablock') })
    expect(useBlockStore.getState().blocks[0].products).toEqual([])
  })

  it('keeps an unreadable stored plan under :corrupt instead of overwriting it', () => {
    useGameDataStore.setState({ status: loadedStatus('seablock') })
    const key = activePlanKey('seablock')
    unsub()
    localStorageMock.setItem(key, 'not json')
    unsub = initAppStatePersistence()
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    useGameDataStore.setState({ status: loadedStatus('seablock') })
    expect(store[key + ':corrupt'], 'raw value is recoverable').toBe('not json')
    expect(readIndex('seablock').plans, 'the plan stays in the list').toHaveLength(1)
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    expect(store[key + ':corrupt']).toBe('not json')
    expect(store[key]).toContain('iron-plate')
  })
})

describe('autosave while game data loads', () => {
  it('does not write while a data set is loading', () => {
    const unsub = initAppStatePersistence()
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    useGameDataStore.setState({ status: { type: 'loading' } })
    const before = { ...store }
    useBlockStore.getState().addProduct({ id: 'g9', itemId: 'iron-plate', extraRate: 1 })
    expect(store).toEqual(before)
    unsub()
  })
})

describe('research horizon', () => {
  let unsub: () => void
  beforeEach(() => { unsub = initAppStatePersistence() })
  afterEach(() => { unsub() })

  it('autosaves when only the horizon changes', () => {
    activateDataSet('nullius')
    vi.clearAllMocks()
    useBlockStore.getState().setHorizonTechnologyIds(['x'])
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      KEY(),
      expect.stringContaining('"horizonTechnologyIds":["x"]'),
    )
  })

  it('autosaves when only the default machine overrides change', () => {
    activateDataSet('nullius')
    vi.clearAllMocks()
    useBlockStore.getState().setDefaultMachine('crafting', 'asm-2')
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      KEY(),
      expect.stringContaining('"defaultMachineOverrides":{"crafting":"asm-2"}'),
    )
  })

  it('restores a stored horizon on activation', () => {
    const block = makeEmptyBlock('Stored')
    localStorageMock.setItem(legacyPlanStorageKey('nullius'), JSON.stringify({ blocks: [block], activeBlockId: block.id, horizonTechnologyIds: ['y'] }))
    activateDataSet('nullius')
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual(['y'])
  })

  it('resets the horizon when the stored plan is corrupt', () => {
    useBlockStore.getState().setHorizonTechnologyIds(['z'])
    localStorageMock.setItem(legacyPlanStorageKey('nullius'), 'not json')
    activateDataSet('nullius')
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual([])
  })
})

describe('custom plans', () => {
  let unsub: () => void
  beforeEach(() => { unsub = initAppStatePersistence() })
  afterEach(() => { unsub() })

  /** Stores a plan list (index, one plan, an old-shape plan and a corrupt copy) for a data set. */
  function storeAllKeys(sourceId: string) {
    localStorageMock.setItem(planIndexKey(sourceId), JSON.stringify({ activePlanId: 'p', plans: [{ id: 'p', name: 'Plan 1' }] }))
    localStorageMock.setItem(planKey(sourceId, 'p'), '{}')
    localStorageMock.setItem(planKey(sourceId, 'p') + ':corrupt', 'x')
    localStorageMock.setItem(legacyPlanStorageKey(sourceId), '{}')
  }

  it('removeCustomPlans drops custom plans but keeps bundled ones and the kept upload', () => {
    storeAllKeys('nullius')
    storeAllKeys('custom:a.json#1')
    storeAllKeys('custom:b.json#2')
    const bKeys = Object.keys(store).filter(k => k.includes('custom:b.json#2')).sort()
    removeCustomPlans('custom:b.json#2')
    expect(Object.keys(store).filter(k => k.includes('custom:a.json#1'))).toEqual([])
    expect(Object.keys(store).filter(k => k.includes('custom:b.json#2')).sort()).toEqual(bKeys)
    expect(Object.keys(store).filter(k => k.includes('nullius'))).toHaveLength(4)
    removeCustomPlans()
    expect(Object.keys(store).filter(k => k.includes('custom:'))).toEqual([])
    expect(Object.keys(store).filter(k => k.includes('nullius'))).toHaveLength(4)
  })

  it('drops an upload whose file name merely starts like the kept one', () => {
    storeAllKeys('custom:a.json#1')
    storeAllKeys('custom:a.json#12')
    removeCustomPlans('custom:a.json#1')
    expect(Object.keys(store).some(k => k.includes('custom:a.json#12'))).toBe(false)
    expect(Object.keys(store).some(k => k.includes('custom:a.json#1'))).toBe(true)
  })

  it('activating a new upload drops the plans of the replaced one', () => {
    storeAllKeys('custom:a.json#1')
    useGameDataStore.setState({ status: loadedStatus('custom:b.json#2') })
    expect(Object.keys(store).some(k => k.includes('custom:a.json#1'))).toBe(false)
    expect(store[planIndexKey('custom:b.json#2')]).toBeDefined()
  })
})

describe('migration of single-plan storage', () => {
  let unsub: () => void
  beforeEach(() => { unsub = initAppStatePersistence() })
  afterEach(() => { unsub() })

  it('moves a data set\'s old plan into the list as the active "Plan 1"', () => {
    storePlan('nullius', 'Old plan')
    const legacy = store[legacyPlanStorageKey('nullius')]
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    const index = readIndex('nullius')
    expect(index.plans).toHaveLength(1)
    expect(index.plans[0].name).toBe('Plan 1')
    expect(index.activePlanId).toBe(index.plans[0].id)
    expect(useBlockStore.getState().blocks[0].name).toBe('Old plan')
    expect(store[legacyPlanStorageKey('nullius')]).toBeUndefined()
    // The autosave may re-serialize the plan, so compare content rather than text.
    expect(JSON.parse(store[KEY()]).blocks).toEqual(JSON.parse(legacy).blocks)
  })

  it('does not list a plan whose copy could not be written, on any reload', () => {
    storePlan('nullius', 'Old plan')
    const legacy = store[legacyPlanStorageKey('nullius')]
    localStorageMock.setItem.mockImplementation((key: string, value: string) => {
      if (key.startsWith('factorio-planner:plan:')) throw new Error('QuotaExceededError')
      store[key] = value
    })
    try {
      for (let i = 0; i < 2; i++) {
        useGameDataStore.setState({ status: { type: 'empty' } })
        usePlansStore.setState({ sourceId: null, index: null })
        useGameDataStore.setState({ status: loadedStatus('nullius') })
        expect(useBlockStore.getState().blocks[0].name).toBe('Old plan')
      }
    } finally {
      localStorageMock.setItem.mockImplementation((key: string, value: string) => { store[key] = value })
    }
    expect(store[planIndexKey('nullius')]).toBeUndefined()
    expect(store[legacyPlanStorageKey('nullius')]).toBe(legacy)
  })

  it('keeps an unreadable old plan under :corrupt of its new key', () => {
    localStorageMock.setItem(legacyPlanStorageKey('nullius'), 'not json')
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(store[legacyPlanStorageKey('nullius')]).toBeUndefined()
    expect(store[KEY() + ':corrupt']).toBe('not json')
    expect(useBlockStore.getState().blocks).toHaveLength(1)
    expect(useBlockStore.getState().blocks[0].name).toBe('Factory')
  })

  it('adopts an old plan that appears while an index exists as an extra active plan', () => {
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    const first = readIndex('nullius').activePlanId
    const firstContent = store[planKey('nullius', first)]
    unsub()
    usePlansStore.setState({ sourceId: null, index: null })
    storePlan('nullius', 'Re-seeded')
    unsub = initAppStatePersistence()
    const index = readIndex('nullius')
    expect(index.plans.map(p => p.name)).toEqual(['Plan 1', 'Plan 2'])
    expect(index.activePlanId).toBe(index.plans[1].id)
    expect(useBlockStore.getState().blocks[0].name).toBe('Re-seeded')
    expect(store[planKey('nullius', first)]).toBe(firstContent)
    expect(store[legacyPlanStorageKey('nullius')]).toBeUndefined()
  })

  it('adopts the global key only with neither an index nor an old key, then deletes it', () => {
    const block = makeEmptyBlock('Global plan')
    localStorageMock.setItem(LEGACY_APP_STATE_STORAGE_KEY, JSON.stringify({ blocks: [block], activeBlockId: block.id }))
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(useBlockStore.getState().blocks[0].name).toBe('Global plan')
    expect(store[LEGACY_APP_STATE_STORAGE_KEY]).toBeUndefined()
    expect(readIndex('nullius').plans).toHaveLength(1)
  })

  it('leaves the global key alone when the data set already has an index', () => {
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    useGameDataStore.setState({ status: loadedStatus('seablock') })
    localStorageMock.setItem(LEGACY_APP_STATE_STORAGE_KEY, JSON.stringify({ blocks: [makeEmptyBlock('Global')], activeBlockId: 'x' }))
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(store[LEGACY_APP_STATE_STORAGE_KEY]).toBeDefined()
    expect(readIndex('nullius').plans).toHaveLength(1)
  })

  it('does not adopt the global key for a data set with an old key', () => {
    storePlan('nullius', 'Own plan')
    localStorageMock.setItem(LEGACY_APP_STATE_STORAGE_KEY, JSON.stringify({ blocks: [makeEmptyBlock('Global')], activeBlockId: 'x' }))
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(useBlockStore.getState().blocks[0].name).toBe('Own plan')
    expect(store[LEGACY_APP_STATE_STORAGE_KEY]).toBeDefined()
  })

  it('keeps the old key when it cannot be copied, and still shows the plan', () => {
    storePlan('nullius', 'Old plan')
    const realSet = localStorageMock.setItem.getMockImplementation()!
    localStorageMock.setItem.mockImplementation((key: string, value: string) => {
      if (key.startsWith('factorio-planner:plan')) throw new Error('QuotaExceededError')
      realSet(key, value)
    })
    try {
      useGameDataStore.setState({ status: loadedStatus('nullius') })
      expect(store[legacyPlanStorageKey('nullius')]).toBeDefined()
      expect(useBlockStore.getState().blocks[0].name).toBe('Old plan')
    } finally {
      localStorageMock.setItem.mockImplementation(realSet)
    }
  })

  it('starts a first visit with one empty "Plan 1" and writes the index', () => {
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(readIndex('nullius').plans.map(p => p.name)).toEqual(['Plan 1'])
    expect(useBlockStore.getState().blocks).toHaveLength(1)
    expect(useBlockStore.getState().blocks[0].name).toBe('Factory')
  })
})

describe('plan index', () => {
  let unsub: () => void
  beforeEach(() => { unsub = initAppStatePersistence() })
  afterEach(() => { unsub() })

  it('quarantines an unreadable index and recovers the plans from their keys', () => {
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    createPlan()
    unsub()
    usePlansStore.setState({ sourceId: null, index: null })
    useGameDataStore.setState({ status: { type: 'empty' } })
    localStorageMock.setItem(planIndexKey('nullius'), 'not json')
    unsub = initAppStatePersistence()
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(store[planIndexKey('nullius') + ':corrupt']).toBe('not json')
    expect(readIndex('nullius').plans.map(p => p.name)).toEqual(['Plan 1', 'Plan 2'])
  })

  it('falls back to the first plan when the active id is unknown', () => {
    localStorageMock.setItem(planIndexKey('nullius'), JSON.stringify({
      activePlanId: 'gone', plans: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    }))
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    expect(usePlansStore.getState().index?.activePlanId).toBe('a')
  })

  it('remembers the active plan across a restart', () => {
    useGameDataStore.setState({ status: loadedStatus('nullius') })
    createPlan()
    renamePlan(readIndex('nullius').activePlanId, 'Second')
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    unsub()
    usePlansStore.setState({ sourceId: null, index: null })
    unsub = initAppStatePersistence()
    const entry = usePlansStore.getState().index!
    expect(entry.plans.find(p => p.id === entry.activePlanId)?.name).toBe('Second')
    expect(useBlockStore.getState().blocks[0].products).toHaveLength(1)
  })
})

describe('plan actions', () => {
  let unsub: () => void
  beforeEach(() => {
    unsub = initAppStatePersistence()
    useGameDataStore.setState({ status: loadedStatus('nullius') })
  })
  afterEach(() => { unsub() })

  const index = () => usePlansStore.getState().index!
  const names = () => index().plans.map(p => p.name)
  const activeName = () => index().plans.find(p => p.id === index().activePlanId)!.name

  it('createPlan saves the current plan, then starts an empty "Plan 2"', () => {
    const firstKey = KEY()
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    useBlockStore.setState({ history: { x: { undoStack: [], redoStack: [] } } })
    expect(createPlan()).toEqual({ type: 'ok' })
    expect(names()).toEqual(['Plan 1', 'Plan 2'])
    expect(activeName()).toBe('Plan 2')
    expect(store[firstKey]).toContain('iron-plate')
    expect(useBlockStore.getState().blocks).toHaveLength(1)
    expect(useBlockStore.getState().blocks[0].products).toEqual([])
    expect(useBlockStore.getState().history).toEqual({})
    expect(store[KEY()], 'autosave writes the new key').toBeDefined()
    expect(KEY()).not.toBe(firstKey)
  })

  it('createPlan saves a changed active block of the current plan', () => {
    const firstKey = KEY()
    const other = makeEmptyBlock('Other')
    useBlockStore.setState({ blocks: [...useBlockStore.getState().blocks, other] })
    useBlockStore.setState({ activeBlockId: other.id })
    createPlan()
    expect(JSON.parse(store[firstKey]).activeBlockId).toBe(other.id)
  })

  it('nextPlanName skips used names', () => {
    expect(nextPlanName(null)).toBe('Plan 1')
    expect(nextPlanName({ activePlanId: 'a', plans: [{ id: 'a', name: 'Plan 2' }] })).toBe('Plan 3')
  })

  it('switchPlan restores the other plan and leaves the old key unchanged', () => {
    const firstId = index().activePlanId
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    useBlockStore.getState().setHorizonTechnologyIds(['x'])
    createPlan()
    const secondKey = KEY()
    const firstContent = store[planKey('nullius', firstId)]
    expect(switchPlan(firstId)).toEqual({ type: 'ok' })
    expect(useBlockStore.getState().blocks[0].products[0]?.itemId).toBe('iron-plate')
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual(['x'])
    expect(store[planKey('nullius', firstId)]).toBe(firstContent)
    expect(store[secondKey]).not.toContain('iron-plate')
    expect(readIndex('nullius').activePlanId).toBe(firstId)
  })

  it('switchPlan is a no-op for the active plan and an error for an unknown one', () => {
    const before = useBlockStore.getState().blocks
    expect(switchPlan(index().activePlanId)).toEqual({ type: 'ok' })
    expect(useBlockStore.getState().blocks).toBe(before)
    expect(switchPlan('nope').type).toBe('error')
    expect(useBlockStore.getState().blocks).toBe(before)
  })

  it('duplicatePlan copies the plan right after the source with fresh ids', () => {
    const source = makeEmptyBlock('Source')
    const consumer = { ...makeEmptyBlock('Consumer'), inputConnections: [{ id: 'c1', itemId: 'iron-plate', fromBlockId: source.id }] }
    useBlockStore.setState({
      blocks: [source, consumer],
      activeBlockId: consumer.id,
      horizonTechnologyIds: ['x'],
      defaultMachineOverrides: { crafting: 'asm-2' },
    })
    const firstId = index().activePlanId
    createPlan()
    switchPlan(firstId)
    const sourceContent = store[planKey('nullius', firstId)]
    expect(duplicatePlan()).toEqual({ type: 'ok' })
    expect(names()).toEqual(['Plan 1', 'Plan 1 (copy)', 'Plan 2'])
    expect(activeName()).toBe('Plan 1 (copy)')
    expect(store[planKey('nullius', firstId)]).toBe(sourceContent)
    const { blocks, activeBlockId, horizonTechnologyIds, defaultMachineOverrides } = useBlockStore.getState()
    expect(defaultMachineOverrides).toEqual({ crafting: 'asm-2' })
    expect(blocks.map(b => b.name)).toEqual(['Source', 'Consumer'])
    expect(blocks.some(b => b.id === source.id || b.id === consumer.id)).toBe(false)
    expect(blocks[1].inputConnections[0].fromBlockId).toBe(blocks[0].id)
    expect(activeBlockId).toBe(blocks[1].id)
    expect(horizonTechnologyIds).toEqual(['x'])
  })

  it('renamePlan trims, cuts to 60 characters and refuses a blank name', () => {
    const id = index().activePlanId
    expect(renamePlan(id, '  Late game  ')).toEqual({ type: 'ok' })
    expect(activeName()).toBe('Late game')
    expect(renamePlan(id, '   ').type).toBe('error')
    expect(activeName()).toBe('Late game')
    renamePlan(id, 'x'.repeat(100))
    expect(activeName()).toHaveLength(60)
    expect(readIndex('nullius').plans[0].name).toHaveLength(60)
  })

  it('deletePlan of a non-active plan removes its key and keeps the store', () => {
    const firstId = index().activePlanId
    createPlan()
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    const before = useBlockStore.getState().blocks
    expect(deletePlan(firstId)).toEqual({ type: 'ok' })
    expect(store[planKey('nullius', firstId)]).toBeUndefined()
    expect(names()).toEqual(['Plan 2'])
    expect(useBlockStore.getState().blocks).toBe(before)
  })

  it('deletePlan of the active plan activates the next one, else the previous one', () => {
    const firstId = index().activePlanId
    createPlan()
    createPlan()
    const [, second, third] = index().plans
    switchPlan(second.id)
    deletePlan(second.id)
    expect(index().activePlanId).toBe(third.id)
    deletePlan(third.id)
    expect(index().activePlanId).toBe(firstId)
  })

  it('deletePlan of the only plan leaves a fresh empty "Plan 1" and never re-saves the old key', () => {
    const oldId = index().activePlanId
    useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
    expect(deletePlan(oldId)).toEqual({ type: 'ok' })
    expect(names()).toEqual(['Plan 1'])
    expect(index().activePlanId).not.toBe(oldId)
    expect(store[planKey('nullius', oldId)]).toBeUndefined()
    expect(useBlockStore.getState().blocks[0].products).toEqual([])
    useBlockStore.getState().addProduct({ id: 'g2', itemId: 'copper-plate', extraRate: 60 })
    expect(store[planKey('nullius', oldId)]).toBeUndefined()
  })

  it('every action errors while game data is loading or another data set is loaded', () => {
    const id = index().activePlanId
    const listed = usePlansStore.getState()
    for (const status of [{ type: 'loading' as const }, loadedStatus('seablock')]) {
      useGameDataStore.setState({ status })
      usePlansStore.setState(listed) // the nullius plan list outlives the data set change
      expect(switchPlan('x').type).toBe('error')
      expect(createPlan().type).toBe('error')
      expect(duplicatePlan().type).toBe('error')
      expect(renamePlan(id, 'y').type).toBe('error')
      expect(deletePlan(id).type).toBe('error')
    }
    expect(names()).toEqual(['Plan 1'])
  })
})

describe('plan names and files', () => {
  it('planNameFromFileName strips the last extension and cuts to 60', () => {
    expect(planNameFromFileName('block-connection.json')).toBe('block-connection')
    expect(planNameFromFileName('a.b.json')).toBe('a.b')
    expect(planNameFromFileName('.json')).toBe('')
    expect(planNameFromFileName(`${'n'.repeat(100)}.json`)).toHaveLength(60)
  })

  it('exportFileName slugs the plan name', () => {
    const date = new Date('2026-10-20T12:00:00Z')
    expect(exportFileName('Early game!', date)).toBe('factorio-plan-early-game-2026-10-20.json')
    expect(exportFileName('   ', date)).toBe('factorio-plan-2026-10-20.json')
    const slug = exportFileName('a'.repeat(100), date).replace('factorio-plan-', '').replace('-2026-10-20.json', '')
    expect(slug.length).toBeLessThanOrEqual(40)
  })

  it('makeDataSetStamp normalises the source id', () => {
    expect(makeDataSetStamp('nullius/', 'Nullius', '2.0.9')).toEqual({ id: 'nullius', name: 'Nullius', factorioVersion: '2.0.9' })
    expect(makeDataSetStamp('custom:a.json#aaaa1111', 'a.json', '2.0.9').id).toBe('custom:a.json#aaaa1111')
  })

  it('dataSetMismatchMessage names both data sets', () => {
    expect(dataSetMismatchMessage({ id: 'kompetenz-seablock', name: 'Seablock', factorioVersion: '2.0.1' }, 'Nullius', '2.0.9'))
      .toBe('This plan was exported for Seablock (Factorio 2.0.1); the loaded game data is Nullius (Factorio 2.0.9).')
  })

  it('dataSetMismatchMessage tells apart two uploads that share a file name', () => {
    const msg = dataSetMismatchMessage({ id: 'custom:game-data.json#aaaa1111', name: 'game-data.json', factorioVersion: '2.0.9' }, 'game-data.json', '2.0.9')
    expect(msg).toBe('This plan was exported for game-data.json (Factorio 2.0.9); the loaded game data is game-data.json (a different mod set) (Factorio 2.0.9).')
  })

  it('exportPlanJson adds the stamp and parses back to the same app state', () => {
    const state: AppState = {
      blocks: [makeEmptyBlock('Factory')],
      activeBlockId: 'x',
      horizonTechnologyIds: [],
      defaultMachineOverrides: {},
    }
    state.activeBlockId = state.blocks[0].id
    const dataSet = { id: 'nullius', name: 'Nullius', factorioVersion: '2.0.9' }
    const out = exportPlanJson(state, dataSet)
    expect(JSON.parse(out).dataSet).toEqual(dataSet)
    expect(parseAppState(JSON.parse(out))).toEqual(state)
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
    if (opts.goal) block.products = [{ id: `${id}-g`, itemId: opts.goal, extraRate: 60 }]
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
      defaultMachineOverrides: {},
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

    describe('data set stamp', () => {
      const check = (dataSet: unknown, sourceId = 'nullius') =>
        checkPlanImport(JSON.stringify({ ...makeState(), ...(dataSet === undefined ? {} : { dataSet }) }), knownData(), sourceId)

      it('reports no stamp and no mismatch for an unstamped file', () => {
        const result = check(undefined)
        expect(result).toMatchObject({ type: 'ok', stamp: null, dataSetMismatch: false })
      })

      it('reports no mismatch when the stamp names the loaded data set', () => {
        expect(check({ id: 'nullius' })).toMatchObject({ type: 'ok', dataSetMismatch: false })
      })

      it('reports a mismatch for another data set and keeps the stamp', () => {
        const result = check({ id: 'kompetenz-seablock', name: 'Seablock' })
        expect(result).toMatchObject({ type: 'ok', dataSetMismatch: true })
        expect(result.type === 'ok' && result.stamp?.name).toBe('Seablock')
      })

      it('ignores a trailing slash in the stamp id', () => {
        expect(check({ id: 'kompetenz-seablock/' }, 'kompetenz-seablock')).toMatchObject({ dataSetMismatch: false })
      })

      it('matches uploads by fingerprint, not file name', () => {
        expect(check({ id: 'custom:a.json#0000abcd' }, 'custom:b.json#0000abcd')).toMatchObject({ dataSetMismatch: false })
      })

      it('reports a mismatch for uploads with different fingerprints', () => {
        expect(check({ id: 'custom:a.json#0000abcd' }, 'custom:a.json#1111ffff')).toMatchObject({ dataSetMismatch: true })
      })

      it('treats a malformed stamp as no stamp', () => {
        expect(check('junk')).toMatchObject({ type: 'ok', stamp: null, dataSetMismatch: false })
      })
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
      expect(result.type === 'ok' && result.appState.blocks[0].products).toEqual([{ id: 'g', itemId: 'iron-plate', extraRate: 60 }])
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

    it('reports the unknown item of a product without extra output', () => {
      const block = makeBlock('b1')
      const state = { ...makeState(), blocks: [{ ...block, products: [{ id: 'p', itemId: 'nope-item' }] }] }
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

  describe('importPlanAsNew', () => {
    let unsub: () => void
    beforeEach(() => { unsub = initAppStatePersistence() })
    afterEach(() => { unsub() })

    it('refuses while no game data is loaded and leaves everything unchanged', () => {
      const before = useBlockStore.getState().blocks
      expect(importPlanAsNew(makeState(), 'nullius', 'a.json')).toEqual({ type: 'error', message: 'Load game data first.' })
      expect(useBlockStore.getState().blocks).toBe(before)
      expect(usePlansStore.getState().index).toBeNull()
    })

    it('refuses when the loaded game data changed since the check', () => {
      useGameDataStore.setState({ status: loadedStatus('seablock') })
      const before = useBlockStore.getState().blocks
      expect(importPlanAsNew(makeState(), 'nullius', 'a.json'))
        .toEqual({ type: 'error', message: 'The loaded game data changed; pick the file again.' })
      expect(useBlockStore.getState().blocks).toBe(before)
      expect(usePlansStore.getState().index!.plans).toHaveLength(1)
    })

    it('adds a plan named after the file, makes it active and leaves the previous plan alone', () => {
      useGameDataStore.setState({ status: loadedStatus('nullius') })
      useBlockStore.getState().addProduct({ id: 'g1', itemId: 'iron-plate', extraRate: 60 })
      const previousId = usePlansStore.getState().index!.activePlanId
      const previous = JSON.stringify(selectAppState(useBlockStore.getState()))
      const imported = makeState('b2')
      expect(importPlanAsNew(imported, 'nullius', 'block-connection.json')).toEqual({ type: 'ok' })
      const index = readIndex('nullius')
      expect(index.plans.map(p => p.name)).toEqual(['Plan 1', 'block-connection'])
      expect(index.activePlanId).toBe(index.plans[1].id)
      const state = useBlockStore.getState()
      expect(state.blocks.map(b => b.name)).toEqual(['b1', 'b2'])
      expect(state.blocks.some(b => imported.blocks.some(i => i.id === b.id)), 'ids are fresh').toBe(false)
      expect(state.activeBlockId).toBe(state.blocks[1].id)
      expect(state.horizonTechnologyIds).toEqual(['electronics'])
      expect(state.history).toEqual({})
      expect(JSON.stringify(JSON.parse(store[planKey('nullius', previousId)]))).toBe(previous)
      expect(store[planKey('nullius', index.activePlanId)]).toContain('electronics')
    })

    it('never stores the data set stamp of an exported file', () => {
      useGameDataStore.setState({ status: loadedStatus('nullius') })
      const check = checkPlanImport(JSON.stringify({ ...makeState(), dataSet: { id: 'nullius' } }), gameDataWith(['iron-plate'], ['iron-plate']), 'nullius')
      expect(check.type).toBe('ok')
      if (check.type !== 'ok') return
      importPlanAsNew(check.appState, check.sourceId, 'stamped.json')
      const stored = JSON.parse(store[planKey('nullius', readIndex('nullius').activePlanId)]) as unknown
      expect(stored).toBeTypeOf('object')
      expect(stored).not.toHaveProperty('dataSet')
    })

    it('names a plan "Plan N" when the file name has no usable base name', () => {
      useGameDataStore.setState({ status: loadedStatus('nullius') })
      importPlanAsNew(makeState(), 'nullius', '.json')
      expect(usePlansStore.getState().index!.plans.map(p => p.name)).toEqual(['Plan 1', 'Plan 2'])
    })

    it('importing the same plan twice gives two plans with no shared block ids', () => {
      useGameDataStore.setState({ status: loadedStatus('nullius') })
      const imported = makeState()
      importPlanAsNew(imported, 'nullius', 'same.json')
      const firstIds = useBlockStore.getState().blocks.map(b => b.id)
      importPlanAsNew(imported, 'nullius', 'same.json')
      expect(usePlansStore.getState().index!.plans.map(p => p.name)).toEqual(['Plan 1', 'same', 'same'])
      expect(useBlockStore.getState().blocks.some(b => firstIds.includes(b.id))).toBe(false)
    })
  })
})
