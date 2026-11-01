import {
  initialConnectionState,
  reduce,
  type ConnectionAction,
  type ConnectionEvent,
  type ConnectionState,
} from './connection'
import { PLANNER_RETRY_MS, encodeAnnounce, encodeSnapshotFrame } from './protocol'

// ---------------------------------------------------------------------------
// The thin adapter around the pure state machine in connection.ts: it owns the WebSocket and the
// timers, turns their events into `ConnectionEvent`s and performs the actions `reduce` returns.
// Nothing here decides anything about the protocol.
// ---------------------------------------------------------------------------

/** The part of the browser's `WebSocket` the controller uses. */
export interface SocketLike {
  binaryType: string
  readyState: number
  onopen: ((ev: Event) => void) | null
  onclose: ((ev: CloseEvent) => void) | null
  onerror: ((ev: Event) => void) | null
  onmessage: ((ev: MessageEvent) => void) | null
  send(data: string | Uint8Array<ArrayBuffer>): void
  close(): void
}

export interface ControllerDeps {
  /** The bridge address at the time of connecting. */
  getUrl: () => string
  createSocket: (url: string) => SocketLike
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  retryMs?: number
  /** How long a socket may stay `connecting` before the badge asks about the browser's permission. */
  slowMs?: number
}

const OPEN = 1
const DEFAULT_SLOW_MS = 2_500

export interface Controller {
  getState: () => ConnectionState
  subscribe: (listener: (state: ConnectionState) => void) => () => void
  dispatch: (event: ConnectionEvent) => void
}

export function createController(deps: ControllerDeps, initialAutoSend = false): Controller {
  const retryMs = deps.retryMs ?? PLANNER_RETRY_MS
  const slowMs = deps.slowMs ?? DEFAULT_SLOW_MS
  let state = initialConnectionState(initialAutoSend)
  let socket: SocketLike | null = null
  let retryTimer: unknown
  let slowTimer: unknown
  const listeners = new Set<(s: ConnectionState) => void>()

  function dropSocket() {
    if (!socket) return
    const old = socket
    socket = null
    old.onopen = old.onclose = old.onerror = old.onmessage = null
    try {
      old.close()
    } catch {
      // Already closed.
    }
  }

  function connect() {
    dropSocket()
    let ws: SocketLike
    try {
      ws = deps.createSocket(deps.getUrl())
    } catch (err) {
      // A malformed address is a SyntaxError; a refusal by the browser (mixed content) a SecurityError.
      dispatch({ type: 'connectThrew', reason: err instanceof Error && err.name === 'SyntaxError' ? 'bad-address' : 'blocked' })
      return
    }
    ws.binaryType = 'arraybuffer'
    socket = ws
    deps.clearTimer(slowTimer)
    slowTimer = deps.setTimer(() => { if (socket === ws) dispatch({ type: 'slow' }) }, slowMs)
    ws.onopen = () => {
      if (socket !== ws) return
      deps.clearTimer(slowTimer)
      dispatch({ type: 'opened' })
    }
    ws.onclose = () => {
      if (socket !== ws) return
      deps.clearTimer(slowTimer)
      socket = null
      dispatch({ type: 'closed' })
    }
    // `close` always follows `error`, and carries no more detail than `error` does.
    ws.onerror = null
    ws.onmessage = ev => {
      if (socket === ws && typeof ev.data === 'string') dispatch({ type: 'text', data: ev.data })
    }
  }

  function perform(action: ConnectionAction) {
    switch (action.type) {
      case 'connect':
        connect()
        break
      case 'disconnect':
        deps.clearTimer(slowTimer)
        dropSocket()
        break
      case 'scheduleRetry':
        deps.clearTimer(retryTimer)
        retryTimer = deps.setTimer(() => dispatch({ type: 'retry' }), retryMs)
        break
      case 'cancelRetry':
        deps.clearTimer(retryTimer)
        retryTimer = undefined
        break
      case 'sendSnapshot':
        if (socket?.readyState === OPEN) socket.send(encodeSnapshotFrame(action.id, action.bytes))
        break
      case 'announce':
        if (socket?.readyState === OPEN) socket.send(encodeAnnounce(action.id))
        break
    }
  }

  // Events raised while performing actions (a socket that throws) are queued, so one `reduce` call
  // never runs inside another.
  const queue: ConnectionEvent[] = []
  let running = false

  function dispatch(event: ConnectionEvent) {
    queue.push(event)
    if (running) return
    running = true
    try {
      for (let e = queue.shift(); e; e = queue.shift()) {
        const next = reduce(state, e)
        state = next.state
        for (const action of next.actions) perform(action)
        for (const l of listeners) l(state)
      }
    } finally {
      running = false
    }
  }

  return {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispatch,
  }
}
