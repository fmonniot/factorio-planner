import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const UI_STATE_STORAGE_KEY = 'factorio-planner:ui'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type RateUnit = 'sec' | 'min'

/** How the production table lists its rows: the block's tree, or one line per recipe over every area. */
export type TableView = 'tree' | 'recipe'

export interface UiStoreState {
  rateUnit: RateUnit
  setRateUnit: (unit: RateUnit) => void
  tableView: TableView
  setTableView: (view: TableView) => void
  /**
   * Transient (not persisted) ask to open the workspace menu on its "Default machines"
   * flyout, optionally focused on one crafting category. `seq` changes on every request.
   */
  defaultMachinesRequest: { seq: number; category: string | undefined } | null
  requestDefaultMachines: (category?: string) => void
  clearDefaultMachinesRequest: () => void
  /** Transient (not persisted) ask to show a production-table row of the active block: expand its sub-factories, scroll to it, flash it. `seq` changes on every request. */
  revealRowRequest: { seq: number; nodeId: string } | null
  requestRevealRow: (nodeId: string) => void
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useUiStore = create<UiStoreState>()((set) => ({
  rateUnit: 'min',
  setRateUnit: (unit) => set({ rateUnit: unit }),
  tableView: 'tree',
  setTableView: (view) => set({ tableView: view }),
  defaultMachinesRequest: null,
  requestDefaultMachines: (category) =>
    set(state => ({ defaultMachinesRequest: { seq: (state.defaultMachinesRequest?.seq ?? 0) + 1, category } })),
  clearDefaultMachinesRequest: () => set({ defaultMachinesRequest: null }),
  revealRowRequest: null,
  requestRevealRow: (nodeId) =>
    set(state => ({ revealRowRequest: { seq: (state.revealRowRequest?.seq ?? 0) + 1, nodeId } })),
}))

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

interface PersistedUiState {
  rateUnit: RateUnit
  tableView: TableView
}

export function saveUiState(): void {
  try {
    const { rateUnit, tableView } = useUiStore.getState()
    const persisted: PersistedUiState = { rateUnit, tableView }
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
    if (parsed.tableView === 'tree' || parsed.tableView === 'recipe') {
      useUiStore.setState({ tableView: parsed.tableView })
    }
  } catch {
    // Malformed or unavailable — start with defaults.
  }
}

export function initUiStatePersistence(): () => void {
  return useUiStore.subscribe((state, prevState) => {
    if (state.rateUnit !== prevState.rateUnit || state.tableView !== prevState.tableView) {
      saveUiState()
    }
  })
}
