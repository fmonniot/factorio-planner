import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useGameDataStore, selectGameData } from './gameDataStore'
import type { GameData } from '../data/types'

// ---------------------------------------------------------------------------
// Minimal valid game data fixture
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

beforeEach(() => {
  useGameDataStore.setState({ status: { type: 'empty' } })
})

// ---------------------------------------------------------------------------
// importGameData
// ---------------------------------------------------------------------------

describe('importGameData', () => {
  it('starts in empty state', () => {
    expect(useGameDataStore.getState().status.type).toBe('empty')
  })

  it('transitions to loaded on valid JSON', () => {
    useGameDataStore.getState().importGameData(makeGameDataJson(), 'test')
    const { status } = useGameDataStore.getState()
    expect(status.type).toBe('loaded')
  })

  it('records the source id on the loaded status', () => {
    useGameDataStore.getState().importGameData(makeGameDataJson(), 'nullius')
    const { status } = useGameDataStore.getState()
    expect(status.type === 'loaded' && status.sourceId).toBe('nullius')
  })

  it('exposes parsed gameData on success', () => {
    useGameDataStore.getState().importGameData(makeGameDataJson({ factorioVersion: '2.0.42' }), 'test')
    const gameData = selectGameData(useGameDataStore.getState())
    expect(gameData?.factorioVersion).toBe('2.0.42')
  })

  it('transitions to error on invalid JSON string', () => {
    useGameDataStore.getState().importGameData('not json', 'test')
    const { status } = useGameDataStore.getState()
    expect(status.type).toBe('error')
  })

  it('transitions to error on schema validation failure', () => {
    useGameDataStore.getState().importGameData('{"factorioVersion": 123}', 'test')
    const { status } = useGameDataStore.getState()
    expect(status.type).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// importGameDataFile
// ---------------------------------------------------------------------------

describe('importGameDataFile', () => {
  it('transitions to loaded after reading a valid File', async () => {
    const json = makeGameDataJson({ factorioVersion: '2.0.1' })
    const file = new File([json], 'game-data.json', { type: 'application/json' })
    await useGameDataStore.getState().importGameDataFile(file)
    const gameData = selectGameData(useGameDataStore.getState())
    expect(gameData?.factorioVersion).toBe('2.0.1')
    const { status } = useGameDataStore.getState()
    expect(status.type === 'loaded' && status.sourceId).toMatch(/^custom:game-data\.json#[0-9a-f]{8}$/)
  })

  it('gives same-named uploads with different mod sets different source ids', async () => {
    const ids: string[] = []
    const modSets: Record<string, string>[] = [{ base: '2.0.0' }, { base: '2.0.0', nullius: '1.0' }]
    for (const modSet of modSets) {
      const file = new File([makeGameDataJson({ modSet })], 'game-data.json')
      await useGameDataStore.getState().importGameDataFile(file)
      const { status } = useGameDataStore.getState()
      if (status.type === 'loaded') ids.push(status.sourceId)
    }
    expect(ids).toHaveLength(2)
    expect(ids[0], 'fingerprint must depend on the mod set').not.toBe(ids[1])
  })

  it('transitions to error after reading an invalid File', async () => {
    const file = new File(['not json'], 'bad.json', { type: 'application/json' })
    await useGameDataStore.getState().importGameDataFile(file)
    const { status } = useGameDataStore.getState()
    expect(status.type).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// importGameDataUrl
// ---------------------------------------------------------------------------

describe('importGameDataUrl', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('ignores a stale response when a newer request was made (last click wins)', async () => {
    let resolveSlow!: (r: { text: () => Promise<string> }) => void
    const slow = new Promise<{ text: () => Promise<string> }>(res => { resolveSlow = res })
    const fast = { text: async () => makeGameDataJson({ factorioVersion: '2.0.2' }) }
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(slow)
      .mockReturnValueOnce(Promise.resolve(fast)))

    const first = useGameDataStore.getState().importGameDataUrl('/slow.json', 'slow')
    await useGameDataStore.getState().importGameDataUrl('/fast.json', 'fast')
    resolveSlow({ text: async () => makeGameDataJson({ factorioVersion: '2.0.1' }) })
    await first

    const { status } = useGameDataStore.getState()
    expect(status.type === 'loaded' && status.sourceId).toBe('fast')
  })
})

// ---------------------------------------------------------------------------
// clearGameData
// ---------------------------------------------------------------------------

describe('clearGameData', () => {
  it('resets to empty', () => {
    useGameDataStore.getState().importGameData(makeGameDataJson(), 'test')
    useGameDataStore.getState().clearGameData()
    expect(useGameDataStore.getState().status.type).toBe('empty')
  })
})

// ---------------------------------------------------------------------------
// selectGameData
// ---------------------------------------------------------------------------

describe('selectGameData', () => {
  it('returns undefined when empty', () => {
    expect(selectGameData(useGameDataStore.getState())).toBeUndefined()
  })

  it('returns gameData when loaded', () => {
    useGameDataStore.getState().importGameData(makeGameDataJson(), 'test')
    expect(selectGameData(useGameDataStore.getState())).toBeDefined()
  })
})
