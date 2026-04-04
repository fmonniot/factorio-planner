import { describe, it, expect, beforeEach } from 'vitest'
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
    defaultMachines: {},
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
    useGameDataStore.getState().importGameData(makeGameDataJson())
    const { status } = useGameDataStore.getState()
    expect(status.type).toBe('loaded')
  })

  it('exposes parsed gameData on success', () => {
    useGameDataStore.getState().importGameData(makeGameDataJson({ factorioVersion: '2.0.42' }))
    const gameData = selectGameData(useGameDataStore.getState())
    expect(gameData?.factorioVersion).toBe('2.0.42')
  })

  it('transitions to error on invalid JSON string', () => {
    useGameDataStore.getState().importGameData('not json')
    const { status } = useGameDataStore.getState()
    expect(status.type).toBe('error')
  })

  it('transitions to error on schema validation failure', () => {
    useGameDataStore.getState().importGameData('{"factorioVersion": 123}')
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
  })

  it('transitions to error after reading an invalid File', async () => {
    const file = new File(['not json'], 'bad.json', { type: 'application/json' })
    await useGameDataStore.getState().importGameDataFile(file)
    const { status } = useGameDataStore.getState()
    expect(status.type).toBe('error')
  })
})

// ---------------------------------------------------------------------------
// clearGameData
// ---------------------------------------------------------------------------

describe('clearGameData', () => {
  it('resets to empty', () => {
    useGameDataStore.getState().importGameData(makeGameDataJson())
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
    useGameDataStore.getState().importGameData(makeGameDataJson())
    expect(selectGameData(useGameDataStore.getState())).toBeDefined()
  })
})
