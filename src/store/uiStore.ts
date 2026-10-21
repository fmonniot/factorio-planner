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
  setRateUnit: (unit: RateUnit) => void
  /**
   * Transient (not persisted) ask to open the workspace menu on its "Default machines"
   * flyout, optionally focused on one crafting category. `seq` changes on every request.
   */
  defaultMachinesRequest: { seq: number; category: string | undefined } | null
  requestDefaultMachines: (category?: string) => void
  clearDefaultMachinesRequest: () => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useUiStore = create<UiStoreState>()((set) => ({
  rateUnit: 'min',
  setRateUnit: (unit) => set({ rateUnit: unit }),
  defaultMachinesRequest: null,
  requestDefaultMachines: (category) =>
    set(state => ({ defaultMachinesRequest: { seq: (state.defaultMachinesRequest?.seq ?? 0) + 1, category } })),
  clearDefaultMachinesRequest: () => set({ defaultMachinesRequest: null }),
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
