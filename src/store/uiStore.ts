import { create } from 'zustand'
import { DEFAULT_BRIDGE_URL } from '../viewer/protocol'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const UI_STATE_STORAGE_KEY = 'factorio-planner:ui'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type RateUnit = 'sec' | 'min'

/** How the production table lists its rows: the block's tree, or one line per recipe over every area. */

export interface UiStoreState {
  rateUnit: RateUnit
  setRateUnit: (unit: RateUnit) => void
  /** Address of the in-game viewer's bridge (a WebSocket URL). The connection itself is never persisted: it starts off. */
  bridgeUrl: string
  setBridgeUrl: (url: string) => void
  /** Send the plan to the in-game viewer after every solve, not only on request. */
  viewerAutoSend: boolean
  setViewerAutoSend: (value: boolean) => void
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
  /**
   * The production-table row (recipe row or group) the side panel shows, with the block it belongs to.
   * Transient (not persisted). The table treats a selection of another block or of a removed node as none.
   */
  selectedRow: { blockId: string; nodeId: string } | null
  selectRow: (blockId: string, nodeId: string) => void
  clearSelectedRow: () => void
  /**
   * A short-lived highlight of one section of the side panel (a chip shortcut opened it for that section). Transient.
   * `seq` changes on every request; the section clears it with `clearPanelHighlight(seq)` once the highlight is over.
   */
  panelHighlight: { seq: number; section: PanelHighlightSection } | null
  /** Select the row and highlight a section of its panel. */
  selectRowSection: (blockId: string, nodeId: string, section: PanelHighlightSection) => void
  clearPanelHighlight: (seq: number) => void
}

export type PanelHighlightSection = 'machine' | 'beacons'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useUiStore = create<UiStoreState>()((set) => ({
  rateUnit: 'min',
  setRateUnit: (unit) => set({ rateUnit: unit }),
  bridgeUrl: DEFAULT_BRIDGE_URL,
  setBridgeUrl: (url) => set({ bridgeUrl: url }),
  viewerAutoSend: false,
  setViewerAutoSend: (value) => set({ viewerAutoSend: value }),
  defaultMachinesRequest: null,
  requestDefaultMachines: (category) =>
    set(state => ({ defaultMachinesRequest: { seq: (state.defaultMachinesRequest?.seq ?? 0) + 1, category } })),
  clearDefaultMachinesRequest: () => set({ defaultMachinesRequest: null }),
  revealRowRequest: null,
  requestRevealRow: (nodeId) =>
    set(state => ({ revealRowRequest: { seq: (state.revealRowRequest?.seq ?? 0) + 1, nodeId } })),
  selectedRow: null,
  selectRow: (blockId, nodeId) =>
    set(state => (state.selectedRow?.blockId === blockId && state.selectedRow.nodeId === nodeId ? state : { selectedRow: { blockId, nodeId } })),
  clearSelectedRow: () => set(state => (state.selectedRow === null ? state : { selectedRow: null, panelHighlight: null })),
  panelHighlight: null,
  selectRowSection: (blockId, nodeId, section) =>
    set(state => ({
      selectedRow: state.selectedRow?.blockId === blockId && state.selectedRow.nodeId === nodeId ? state.selectedRow : { blockId, nodeId },
      panelHighlight: { seq: (state.panelHighlight?.seq ?? 0) + 1, section },
    })),
  clearPanelHighlight: (seq) => set(state => (state.panelHighlight?.seq === seq ? { panelHighlight: null } : state)),
}))

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

interface PersistedUiState {
  rateUnit: RateUnit
  bridgeUrl: string
  viewerAutoSend: boolean
}

export function saveUiState(): void {
  try {
    const { rateUnit, bridgeUrl, viewerAutoSend } = useUiStore.getState()
    const persisted: PersistedUiState = { rateUnit, bridgeUrl, viewerAutoSend }
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
    if (typeof parsed.bridgeUrl === 'string' && parsed.bridgeUrl !== '') {
      useUiStore.setState({ bridgeUrl: parsed.bridgeUrl })
    }
    if (typeof parsed.viewerAutoSend === 'boolean') {
      useUiStore.setState({ viewerAutoSend: parsed.viewerAutoSend })
    }
  } catch {
    // Malformed or unavailable — start with defaults.
  }
}

export function initUiStatePersistence(): () => void {
  return useUiStore.subscribe((state, prevState) => {
    if (
      state.rateUnit !== prevState.rateUnit ||
      state.bridgeUrl !== prevState.bridgeUrl || state.viewerAutoSend !== prevState.viewerAutoSend
    ) {
      saveUiState()
    }
  })
}
