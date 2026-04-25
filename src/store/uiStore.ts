import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const UI_STATE_STORAGE_KEY = 'factorio-planner:ui'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type RateUnit = 'sec' | 'min'

export interface UiStoreState {
  rateUnit: RateUnit
  activeFloorPath: string[]

  setRateUnit: (unit: RateUnit) => void
  pushFloor: (subPlanId: string) => void
  popFloor: () => void
  resetFloor: () => void
  setFloorPath: (path: string[]) => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useUiStore = create<UiStoreState>()((set) => ({
  rateUnit: 'min',
  activeFloorPath: [],

  setRateUnit: (unit) => set({ rateUnit: unit }),
  pushFloor: (subPlanId) =>
    set((s) => ({ activeFloorPath: [...s.activeFloorPath, subPlanId] })),
  popFloor: () =>
    set((s) => ({ activeFloorPath: s.activeFloorPath.slice(0, -1) })),
  resetFloor: () => set({ activeFloorPath: [] }),
  setFloorPath: (path) => set({ activeFloorPath: path }),
}))

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

interface PersistedUiState {
  rateUnit: RateUnit
}

export function saveUiState(): void {
  try {
    const { rateUnit } = useUiStore.getState()
    const persisted: PersistedUiState = { rateUnit }
    localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify(persisted))
  } catch {
    // Storage quota exceeded or unavailable — ignore.
  }
}

export function loadPersistedUiState(): void {
  try {
    const raw = localStorage.getItem(UI_STATE_STORAGE_KEY)
    if (raw === null) return
    const parsed = JSON.parse(raw) as Partial<PersistedUiState>
    if (parsed.rateUnit === 'sec' || parsed.rateUnit === 'min') {
      useUiStore.setState({ rateUnit: parsed.rateUnit })
    }
  } catch {
    // Malformed or unavailable — start with defaults.
  }
}

export function initUiStatePersistence(): () => void {
  return useUiStore.subscribe((state, prevState) => {
    if (state.rateUnit !== prevState.rateUnit) {
      saveUiState()
    }
  })
}
