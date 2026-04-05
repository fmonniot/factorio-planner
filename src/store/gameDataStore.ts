import { create } from 'zustand'
import type { GameData } from '../data/types'
import { loadGameDataFromJson, GameDataLoadError } from '../data/loader'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type GameDataStatus =
  | { type: 'empty' }
  | { type: 'loading' }
  | { type: 'loaded'; gameData: GameData }
  | { type: 'error'; message: string }

export interface GameDataStoreState {
  status: GameDataStatus

  /**
   * Import game data from a raw JSON string (e.g. from a File read by the user).
   * Updates status to 'loaded' on success or 'error' on validation failure.
   */
  importGameData: (json: string) => void

  /**
   * Import game data from a File object selected by the user.
   * Returns a promise that resolves when the file has been read and parsed.
   */
  importGameDataFile: (file: File) => Promise<void>

  /**
   * Import game data by fetching a URL (e.g. a server-bundled dataset).
   * Returns a promise that resolves when the data has been fetched and parsed.
   */
  importGameDataUrl: (url: string) => Promise<void>

  /**
   * Clear the currently loaded game data.
   */
  clearGameData: () => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGameDataStore = create<GameDataStoreState>((set) => ({
  status: { type: 'empty' },

  importGameData: (json) => {
    try {
      const gameData = loadGameDataFromJson(json)
      set({ status: { type: 'loaded', gameData } })
    } catch (err) {
      if (err instanceof GameDataLoadError) {
        set({ status: { type: 'error', message: err.message } })
      } else if (err instanceof SyntaxError) {
        set({ status: { type: 'error', message: `Invalid JSON: ${err.message}` } })
      } else {
        set({ status: { type: 'error', message: String(err) } })
      }
    }
  },

  importGameDataFile: async (file) => {
    set({ status: { type: 'loading' } })
    try {
      const json = await file.text()
      const gameData = loadGameDataFromJson(json)
      set({ status: { type: 'loaded', gameData } })
    } catch (err) {
      if (err instanceof GameDataLoadError) {
        set({ status: { type: 'error', message: err.message } })
      } else if (err instanceof SyntaxError) {
        set({ status: { type: 'error', message: `Invalid JSON: ${err.message}` } })
      } else {
        set({ status: { type: 'error', message: String(err) } })
      }
    }
  },

  importGameDataUrl: async (url) => {
    set({ status: { type: 'loading' } })
    try {
      const json = await fetch(url).then(r => r.text())
      const gameData = loadGameDataFromJson(json)
      set({ status: { type: 'loaded', gameData } })
    } catch (err) {
      if (err instanceof GameDataLoadError) {
        set({ status: { type: 'error', message: err.message } })
      } else if (err instanceof SyntaxError) {
        set({ status: { type: 'error', message: `Invalid JSON: ${err.message}` } })
      } else {
        set({ status: { type: 'error', message: String(err) } })
      }
    }
  },

  clearGameData: () => set({ status: { type: 'empty' } }),
}))

// ---------------------------------------------------------------------------
// Selector helpers
// ---------------------------------------------------------------------------

/** Returns the loaded GameData, or undefined if not loaded. */
export function selectGameData(state: GameDataStoreState): GameData | undefined {
  return state.status.type === 'loaded' ? state.status.gameData : undefined
}
