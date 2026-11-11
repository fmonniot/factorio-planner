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
  /** The summary strip shows one line per pane (true, the default) or the three full panes. Persisted; it spans block switches. */
  summaryCollapsed: boolean
  setSummaryCollapsed: (value: boolean) => void
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
  panelHighlight: { seq: number; blockId: string; nodeId: string; section: PanelHighlightSection } | null
  /** Select the row and highlight a section of its panel. */
  selectRowSection: (blockId: string, nodeId: string, section: PanelHighlightSection) => void
  clearPanelHighlight: (seq: number) => void
  /**
   * A transient (not persisted) ask to show the Ingredients slot of one item of the active block. `seq` changes on
   * every request. Set by `openIngredientSlot` and consumed by the summary strip (`FactorySummary`), which clears it
   * with `clearIngredientSlotRequest(seq)`; nothing else reads it.
   */
  ingredientSlotRequest: { seq: number; itemId: string } | null
  /**
   * Show the Ingredients slot of `itemId` in the active block (an item that has one: it is imported, connected or locked).
   * The summary strip expands if it is collapsed, selects the slot and moves keyboard focus into its Comes from group; a
   * row side panel that is a drawer closes, since it would cover the strip and hold the focus. Where a rule is set is
   * `openComesFrom`, not this.
   */
  openIngredientSlot: (itemId: string) => void
  clearIngredientSlotRequest: (seq: number) => void
  /**
   * The Comes from popover (`ComesFromPopover`): the item whose control it shows and where it was opened from. Transient.
   * At most one is open; opening another replaces it. It holds for any item of the active block, whether or not the item
   * has an Ingredients slot, and it closes with a block change.
   */
  comesFromPopover: { itemId: string; anchor: PopoverAnchor } | null
  openComesFrom: (itemId: string, anchor: PopoverAnchor) => void
  closeComesFrom: () => void
  /**
   * The connection menu (`ConnectionMenu`) for an item of the active block, at viewport coordinates. It is a store
   * request because two places open it: the Ingredients slot (strip and right-click) and the Comes from control (the
   * **Receive from…** button of a "No connection" line, which may sit in a popover). `FactorySummary` draws it.
   */
  connectionMenu: { itemId: string; x: number; y: number } | null
  openConnectionMenu: (itemId: string, x: number, y: number) => void
  closeConnectionMenu: () => void
}

/** A box in viewport coordinates. */
export interface ViewportRect { left: number; top: number; right: number; bottom: number }

/**
 * Where a popover opens from: the box of the element that asked, and the box of the row side panel when that element is
 * in it. The panel sits at the right edge and the popover would cover what it explains, so it opens beside the panel.
 * The boxes are a snapshot for when the element has left the page.
 */
export interface PopoverAnchor {
  rect: ViewportRect
  avoid: ViewportRect | null
  /** The element that asked, so that the popover follows it while it stays in the page (it scrolls with the table or the panel). */
  el?: Element
}

export type PanelHighlightSection = 'machine' | 'beacons'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** How long a chip shortcut's highlight of a panel section lasts. */
export const HIGHLIGHT_MS = 1600
let highlightSeq = 0
let ingredientSlotSeq = 0

export const useUiStore = create<UiStoreState>()((set) => ({
  rateUnit: 'min',
  setRateUnit: (unit) => set({ rateUnit: unit }),
  bridgeUrl: DEFAULT_BRIDGE_URL,
  setBridgeUrl: (url) => set({ bridgeUrl: url }),
  viewerAutoSend: false,
  setViewerAutoSend: (value) => set({ viewerAutoSend: value }),
  summaryCollapsed: true,
  setSummaryCollapsed: (value) => set({ summaryCollapsed: value }),
  defaultMachinesRequest: null,
  requestDefaultMachines: (category) =>
    set(state => ({ defaultMachinesRequest: { seq: (state.defaultMachinesRequest?.seq ?? 0) + 1, category } })),
  clearDefaultMachinesRequest: () => set({ defaultMachinesRequest: null }),
  revealRowRequest: null,
  requestRevealRow: (nodeId) =>
    set(state => ({ revealRowRequest: { seq: (state.revealRowRequest?.seq ?? 0) + 1, nodeId } })),
  selectedRow: null,
  // Selecting another row drops a live highlight: it belongs to the row that asked for it.
  selectRow: (blockId, nodeId) =>
    set(state => (state.selectedRow?.blockId === blockId && state.selectedRow.nodeId === nodeId ? state : { selectedRow: { blockId, nodeId }, panelHighlight: null })),
  clearSelectedRow: () => set(state => (state.selectedRow === null ? state : { selectedRow: null, panelHighlight: null })),
  panelHighlight: null,
  selectRowSection: (blockId, nodeId, section) => {
    const seq = (highlightSeq += 1)
    set(state => ({
      selectedRow: state.selectedRow?.blockId === blockId && state.selectedRow.nodeId === nodeId ? state.selectedRow : { blockId, nodeId },
      panelHighlight: { seq, blockId, nodeId, section },
    }))
    // The highlight ends on its own even when no mounted section shows it (the row's panel has no such section).
    setTimeout(() => useUiStore.getState().clearPanelHighlight(seq), HIGHLIGHT_MS)
  },
  clearPanelHighlight: (seq) => set(state => (state.panelHighlight?.seq === seq ? { panelHighlight: null } : state)),
  ingredientSlotRequest: null,
  openIngredientSlot: (itemId) => set({ ingredientSlotRequest: { seq: (ingredientSlotSeq += 1), itemId } }),
  clearIngredientSlotRequest: (seq) => set(state => (state.ingredientSlotRequest?.seq === seq ? { ingredientSlotRequest: null } : state)),
  comesFromPopover: null,
  openComesFrom: (itemId, anchor) => set({ comesFromPopover: { itemId, anchor } }),
  closeComesFrom: () => set(state => (state.comesFromPopover === null ? state : { comesFromPopover: null })),
  connectionMenu: null,
  openConnectionMenu: (itemId, x, y) => set({ connectionMenu: { itemId, x, y } }),
  closeConnectionMenu: () => set(state => (state.connectionMenu === null ? state : { connectionMenu: null })),
}))

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

interface PersistedUiState {
  rateUnit: RateUnit
  bridgeUrl: string
  viewerAutoSend: boolean
  summaryCollapsed: boolean
}

export function saveUiState(): void {
  try {
    const { rateUnit, bridgeUrl, viewerAutoSend, summaryCollapsed } = useUiStore.getState()
    const persisted: PersistedUiState = { rateUnit, bridgeUrl, viewerAutoSend, summaryCollapsed }
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
    if (typeof parsed.summaryCollapsed === 'boolean') {
      useUiStore.setState({ summaryCollapsed: parsed.summaryCollapsed })
    }
  } catch {
    // Malformed or unavailable — start with defaults.
  }
}

export function initUiStatePersistence(): () => void {
  return useUiStore.subscribe((state, prevState) => {
    if (
      state.rateUnit !== prevState.rateUnit ||
      state.bridgeUrl !== prevState.bridgeUrl || state.viewerAutoSend !== prevState.viewerAutoSend ||
      state.summaryCollapsed !== prevState.summaryCollapsed
    ) {
      saveUiState()
    }
  })
}
