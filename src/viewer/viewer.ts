import { useSyncExternalStore } from 'react'
import { projectSnapshot } from '../snapshot/project'
import { dataSetName } from '../store/dataSets'
import { selectAppState, useBlockStore } from '../store/blockStore'
import { selectGameData, useGameDataStore } from '../store/gameDataStore'
import { makeDataSetStamp } from '../store/persistence'
import { useSolverStore } from '../store/solverStore'
import { useUiStore } from '../store/uiStore'
import { badgeFor, type ConnectionState } from './connection'
import { createController } from './controller'
import { MAX_SNAPSHOT_BYTES, snapshotBytes, snapshotId } from './protocol'

// ---------------------------------------------------------------------------
// The app's single connection to the in-game viewer's bridge. Creating it opens nothing: the
// socket is opened only after the player switches the connection on (`viewer.dispatch({type:
// 'enable'})`), and the solver subscription below does no work while the connection is off.
// ---------------------------------------------------------------------------

export const viewer = createController(
  {
    getUrl: () => useUiStore.getState().bridgeUrl,
    createSocket: url => new WebSocket(url),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
  false,
)

/** The connection state, for React. */
export function useViewerState(): ConnectionState {
  return useSyncExternalStore(viewer.subscribe, viewer.getState)
}

/** What the workspace menu's trigger adds to its accessible name: the connection, once it says something. */
export function useViewerTriggerName(): string {
  const badge = badgeFor(useViewerState())
  return badge.tone === 'idle' ? '' : `In-game viewer: ${badge.label}`
}

/** Turns auto-send on or off, here and in the persisted setting. */
export function setViewerAutoSend(value: boolean): void {
  useUiStore.getState().setViewerAutoSend(value)
  viewer.dispatch({ type: 'setAutoSend', value })
}

/**
 * Builds the snapshot of the latest solve and hands its id and bytes to the connection. Returns
 * early (and builds nothing) while the connection is off, while a solve is pending, or without
 * game data.
 */
export async function publishLatestPlan(isCurrent: () => boolean): Promise<void> {
  if (viewer.getState().phase === 'off') return
  const gameData = selectGameData(useGameDataStore.getState())
  const gameDataStatus = useGameDataStore.getState().status
  const solver = useSolverStore.getState()
  if (!gameData || gameDataStatus.type !== 'loaded') return
  if (solver.status.type === 'pending' || solver.status.type === 'idle') return
  if (Object.keys(solver.lastResults).length === 0) return

  try {
    const stamp = makeDataSetStamp(gameDataStatus.sourceId, dataSetName(gameDataStatus.sourceId), gameData.factorioVersion)
    const snapshot = projectSnapshot(
      selectAppState(useBlockStore.getState()),
      { results: solver.lastResults, errors: solver.lastErrors, flows: solver.flows, loops: solver.loops, requestLoops: solver.requestLoops, served: solver.served },
      gameData,
      stamp,
    )
    const bytes = snapshotBytes(snapshot)
    const id = await snapshotId(bytes)
    if (!isCurrent()) return
    if (viewer.getState().plan?.id === id) {
      // Same bytes as before: nothing to send, but an earlier build failure is over.
      viewer.dispatch({ type: 'buildCleared' })
      return
    }
    viewer.dispatch({
      type: 'solved',
      plan: { id, size: bytes.length, bytes: bytes.length > MAX_SNAPSHOT_BYTES ? undefined : bytes },
    })
  } catch (err) {
    if (isCurrent()) viewer.dispatch({ type: 'buildFailed', message: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * Feeds every new solve to the connection. Called once at app startup. Returns the cleanup.
 */
export function wireViewer(): () => void {
  let generation = 0
  const rebuild = () => {
    const mine = ++generation
    void publishLatestPlan(() => mine === generation)
  }
  viewer.dispatch({ type: 'setAutoSend', value: useUiStore.getState().viewerAutoSend })

  const unsubSolver = useSolverStore.subscribe((state, prev) => {
    if (state.lastResults !== prev.lastResults || state.status.type !== prev.status.type) rebuild()
  })
  // Switching the connection on builds the plan once, whatever the solver last did.
  let wasOff = viewer.getState().phase === 'off'
  const unsubViewer = viewer.subscribe(state => {
    const isOff = state.phase === 'off'
    if (wasOff && !isOff) rebuild()
    // A build still running was started for a connection that is gone: its result is stale.
    if (!wasOff && isOff) generation++
    wasOff = isOff
  })
  return () => {
    unsubSolver()
    unsubViewer()
    generation++
    viewer.dispatch({ type: 'disable' })
  }
}
