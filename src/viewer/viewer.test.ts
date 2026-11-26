import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGameDataStore } from '../store/gameDataStore'
import { useSolverStore } from '../store/solverStore'
import { REBUILD_DEBOUNCE_MS, viewer, wireViewer } from './viewer'

// A build starts by reading the game data store (twice), so its calls count the builds.
const READS_PER_BUILD = 2

describe('wireViewer', () => {
  let cleanup: () => void
  let builds: ReturnType<typeof vi.spyOn>

  const solve = () => useSolverStore.setState({ lastResults: {} })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', class { close() {} send() {} })
    cleanup = wireViewer()
    viewer.dispatch({ type: 'enable' })
    builds = vi.spyOn(useGameDataStore, 'getState')
    builds.mockClear() // the build the switch itself triggers
  })

  afterEach(() => {
    cleanup()
    builds.mockRestore()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('builds once after a run of solves', () => {
    solve()
    solve()
    solve()
    expect(builds).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REBUILD_DEBOUNCE_MS)
    expect(builds).toHaveBeenCalledTimes(READS_PER_BUILD)
  })

  it('builds nothing once the connection is switched off', () => {
    solve()
    viewer.dispatch({ type: 'disable' })
    vi.advanceTimersByTime(REBUILD_DEBOUNCE_MS * 2)
    expect(builds).not.toHaveBeenCalled()
  })

  it('builds nothing after the cleanup', () => {
    solve()
    cleanup()
    vi.advanceTimersByTime(REBUILD_DEBOUNCE_MS * 2)
    expect(builds).not.toHaveBeenCalled()
  })
})
