import { create } from 'zustand'
import type { GameData } from '../data/types'
import { loadGameDataFromJson, GameDataLoadError } from '../data/loader'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type GameDataStatus =
  | { type: 'empty' }
  | { type: 'loading' }
  | { type: 'loaded'; gameData: GameData; sourceId: string }
  | { type: 'error'; message: string }

export interface GameDataStoreState {
  status: GameDataStatus

  /**
   * Import game data from a raw JSON string (e.g. from a File read by the user).
   * Updates status to 'loaded' on success or 'error' on validation failure.
   *
   * `sourceId` identifies the data set (e.g. `nullius`, `custom:<filename>`);
   * it keys the persisted plan, see persistence.ts.
   */
  importGameData: (json: string, sourceId: string) => void

  /**
   * Import game data from a File object selected by the user. The source id
   * is `custom:<filename>`.
   * Returns a promise that resolves when the file has been read and parsed.
   */
  importGameDataFile: (file: File) => Promise<void>

  /**
   * Import game data by fetching a URL (e.g. a server-bundled dataset).
   * Returns a promise that resolves when the data has been fetched and parsed.
   */
  importGameDataUrl: (url: string, sourceId: string) => Promise<void>

  /**
   * Clear the currently loaded game data.
   */
  clearGameData: () => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function errorStatus(err: unknown): GameDataStatus {
  if (err instanceof GameDataLoadError) {
    return { type: 'error', message: err.message }
  } else if (err instanceof SyntaxError) {
    return { type: 'error', message: `Invalid JSON: ${err.message}` }
  }
  return { type: 'error', message: String(err) }
}

/** Bumped on every async import so a stale in-flight response can be ignored (last request wins). */
let latestRequest = 0

export const useGameDataStore = create<GameDataStoreState>((set) => ({
  status: { type: 'empty' },

  importGameData: (json, sourceId) => {
    // A synchronous import supersedes any in-flight async one.
    latestRequest++
    try {
      const gameData = loadGameDataFromJson(json)
      set({ status: { type: 'loaded', gameData, sourceId } })
    } catch (err) {
      set({ status: errorStatus(err) })
    }
  },

  importGameDataFile: async (file) => {
    const request = ++latestRequest
    set({ status: { type: 'loading' } })
    try {
      const json = await file.text()
      const gameData = loadGameDataFromJson(json)
      if (request !== latestRequest) return
      set({ status: { type: 'loaded', gameData, sourceId: `custom:${file.name}` } })
    } catch (err) {
      if (request !== latestRequest) return
      set({ status: errorStatus(err) })
    }
  },

  importGameDataUrl: async (url, sourceId) => {
    const request = ++latestRequest
    set({ status: { type: 'loading' } })
    try {
      const json = await fetch(url).then(r => r.text())
      const gameData = loadGameDataFromJson(json)
      if (request !== latestRequest) return
      set({ status: { type: 'loaded', gameData, sourceId } })
    } catch (err) {
      if (request !== latestRequest) return
      set({ status: errorStatus(err) })
    }
  },

  clearGameData: () => {
    latestRequest++
    set({ status: { type: 'empty' } })
  },
}))

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------

/** Returns the loaded GameData, or undefined if not loaded. */
export function selectGameData(state: GameDataStoreState): GameData | undefined {
  return state.status.type === 'loaded' ? state.status.gameData : undefined
}
