import {
  MAX_SNAPSHOT_BYTES,
  PROTOCOL_VERSION,
  describeBridgeError,
  parseBridgeMessage,
  type BridgeStatus,
} from './protocol'

// ---------------------------------------------------------------------------
// The planner's half of the bridge protocol as a pure state machine. `reduce` takes the state and
// one event (a socket event, a timer, a solve result, a click) and returns the next state plus the
// actions the adapter (controller.ts) must perform. No socket, no timer, no clock in here.
//
// The numbered steps in the comments are those of "What the planner does" in the wire protocol.
// ---------------------------------------------------------------------------

/** The plan as the last solve left it. `bytes` is dropped above the size guard, so a huge plan is not kept. */
export interface PlanSnapshot {
  id: string
  size: number
  bytes?: Uint8Array
}

/** Snapshot bytes that were sent, kept to restore an empty bridge. */
export interface SentSnapshot {
  id: string
  bytes: Uint8Array
}

export type Phase =
  /** The connection is switched off: no socket, no timer. */
  | 'off'
  /** A socket is opening. */
  | 'connecting'
  /** The socket is open. */
  | 'open'
  /** The connection is on and the socket is closed; a retry is scheduled. */
  | 'waiting'

/** Why the last attempt to open the socket did not succeed. */
export type Failure =
  /** The socket closed without opening: no bridge, or a browser, extension or network rule in the way. */
  | 'unreachable'
  /** The browser refused to create the socket at all (mixed content, a policy). */
  | 'blocked'
  /** The address is not a valid WebSocket address. */
  | 'bad-address'
  /** An open socket closed. */
  | 'lost'

export interface ConnectionState {
  phase: Phase
  /** The socket has been opening for a while: the browser may be asking the player's permission. */
  slowConnect: boolean
  failure?: Failure
  /** The latest `status`, from the open socket. */
  status?: BridgeStatus
  /** The first `status` of this socket has been handled (steps 1 to 3 run once per connection). */
  firstStatusSeen: boolean
  /** Set from the first `status`: the bridge's protocol version when it differs from ours. */
  protocolMismatch?: number
  autoSend: boolean
  /** The plan as of the last solve. */
  plan?: PlanSnapshot
  /** The last bytes sent, kept for a restore; forgotten when the bridge refuses them. */
  lastSent?: SentSnapshot
  /** The most recent frame this socket sent; a bridge `error` answers it. */
  lastFrame?: 'snapshot' | 'announce'
  /** The last two frames were a restore and its announce, so an error may be about either. */
  lastFramePaired: boolean
  /** The bridge's latest `status` claims our protocol version but could not be read. */
  statusUnreadable?: boolean
  /** The code of the last `error` from the bridge. */
  error?: string
  /** A problem in building the snapshot (for example no `crypto.subtle`); shown to the player. */
  buildError?: string
}

export type ConnectionEvent =
  | { type: 'enable' }
  | { type: 'disable' }
  | { type: 'setAutoSend'; value: boolean }
  /** The socket opened. */
  | { type: 'opened' }
  /** The socket closed (or failed to open). */
  | { type: 'closed' }
  /** `new WebSocket` threw. */
  | { type: 'connectThrew'; reason: 'blocked' | 'bad-address' }
  /** The socket has been connecting for a while. */
  | { type: 'slow' }
  /** The retry timer fired. */
  | { type: 'retry' }
  /** A text frame from the bridge. */
  | { type: 'text'; data: string }
  /** A solve produced a plan with a new id. */
  | { type: 'solved'; plan: PlanSnapshot }
  /** The snapshot of the latest solve could not be built. */
  | { type: 'buildFailed'; message: string }
  /** The latest solve produced the plan already known, so an earlier build failure is over. */
  | { type: 'buildCleared' }
  /** The player pressed Send. */
  | { type: 'send' }
  /** A frame could not be written to the socket (not open, or `send` threw): it did not go out. */
  | { type: 'sendFailed'; frame: 'snapshot' | 'announce'; id: string }

export type ConnectionAction =
  | { type: 'connect' }
  | { type: 'disconnect' }
  | { type: 'scheduleRetry' }
  | { type: 'cancelRetry' }
  | { type: 'sendSnapshot'; id: string; bytes: Uint8Array }
  | { type: 'announce'; id: string }

export interface Transition {
  state: ConnectionState
  actions: ConnectionAction[]
}

export function initialConnectionState(autoSend = false): ConnectionState {
  return { phase: 'off', slowConnect: false, firstStatusSeen: false, autoSend, lastFramePaired: false }
}

export const isTooLarge = (plan: PlanSnapshot | undefined): boolean => !!plan && plan.size > MAX_SNAPSHOT_BYTES

/** True once the bridge has spoken and speaks our protocol: only then may the planner send. */
export function canSend(state: ConnectionState): boolean {
  return state.phase === 'open' && state.firstStatusSeen && state.protocolMismatch === undefined && !state.statusUnreadable
}

/** Next state after a socket that is gone, whatever the cause. */
function lose(state: ConnectionState, failure: Failure): Transition {
  return {
    state: {
      ...state,
      phase: 'waiting',
      slowConnect: false,
      failure,
      status: undefined,
      firstStatusSeen: false,
      protocolMismatch: undefined,
      statusUnreadable: false,
      lastFrame: undefined,
      lastFramePaired: false,
      // A bridge `error` answered a frame of the socket that is gone.
      error: undefined,
    },
    actions: [{ type: 'scheduleRetry' }],
  }
}

/** Sends a snapshot frame and remembers its bytes. */
function sendingSnapshot(state: ConnectionState, id: string, bytes: Uint8Array): Transition {
  return {
    state: { ...state, lastSent: { id, bytes }, lastFrame: 'snapshot', lastFramePaired: false, error: undefined },
    actions: [{ type: 'sendSnapshot', id, bytes }],
  }
}

function announcing(state: ConnectionState, id: string): Transition {
  return { state: { ...state, lastFrame: 'announce', lastFramePaired: false }, actions: [{ type: 'announce', id }] }
}

/** Step 4: after a solve or a Send, send the snapshot or announce, with the size check first. */
function deliver(state: ConnectionState, plan: PlanSnapshot, wantSnapshot: boolean): Transition {
  if (wantSnapshot && !isTooLarge(plan) && plan.bytes) return sendingSnapshot(state, plan.id, plan.bytes)
  return announcing(state, plan.id)
}

/** Steps 1 to 3, on the first `status` of a socket. */
function firstStatus(state: ConnectionState, status: BridgeStatus): Transition {
  const seen = { ...state, status, firstStatusSeen: true, statusUnreadable: false }
  // Step 1: another protocol version. Send nothing and keep the socket open.
  if (status.protocol !== PROTOCOL_VERSION) return { state: { ...seen, protocolMismatch: status.protocol }, actions: [] }

  const actions: ConnectionAction[] = []
  let next: ConnectionState = { ...seen, protocolMismatch: undefined }
  // Step 2: restore, but only onto an empty bridge.
  let restored = false
  if (state.lastSent && !status.transfer && status.newest === undefined) {
    const t = sendingSnapshot(next, state.lastSent.id, state.lastSent.bytes)
    next = t.state
    actions.push(...t.actions)
    restored = true
  }
  // Step 3: announce the current plan unless the bridge now holds exactly its bytes: it just
  // received them in the restore, or it already reports that id as its newest.
  const holdsPlan = !!state.plan && ((restored && state.lastSent?.id === state.plan.id) || status.newest === state.plan.id)
  if (state.plan && !holdsPlan) {
    const t = announcing(next, state.plan.id)
    next = { ...t.state, lastFramePaired: restored }
    actions.push(...t.actions)
  }
  return { state: next, actions }
}

export function reduce(state: ConnectionState, event: ConnectionEvent): Transition {
  switch (event.type) {
    case 'enable':
      if (state.phase !== 'off') return { state, actions: [] }
      return {
        state: { ...state, phase: 'connecting', slowConnect: false, failure: undefined, error: undefined },
        actions: [{ type: 'connect' }],
      }

    case 'disable':
      if (state.phase === 'off') return { state, actions: [] }
      return {
        // The plan is dropped: while off nothing is built, so it goes stale, and the one built on
        // the next enable must be the only plan announced. The sent bytes stay, for a restore.
        state: {
          ...initialConnectionState(state.autoSend),
          lastSent: state.lastSent,
        },
        actions: [{ type: 'cancelRetry' }, { type: 'disconnect' }],
      }

    case 'setAutoSend':
      return { state: { ...state, autoSend: event.value }, actions: [] }

    case 'opened':
      if (state.phase !== 'connecting') return { state, actions: [] }
      return {
        state: {
          ...state,
          phase: 'open',
          slowConnect: false,
          failure: undefined,
          error: undefined,
          status: undefined,
          firstStatusSeen: false,
          protocolMismatch: undefined,
          statusUnreadable: false,
          lastFrame: undefined,
          lastFramePaired: false,
        },
        actions: [],
      }

    case 'closed':
      if (state.phase === 'connecting') return lose(state, 'unreachable')
      if (state.phase === 'open') return lose(state, 'lost')
      return { state, actions: [] }

    case 'connectThrew':
      if (state.phase !== 'connecting') return { state, actions: [] }
      return lose(state, event.reason)

    case 'slow':
      return state.phase === 'connecting' ? { state: { ...state, slowConnect: true }, actions: [] } : { state, actions: [] }

    case 'retry':
      if (state.phase !== 'waiting') return { state, actions: [] }
      return { state: { ...state, phase: 'connecting', slowConnect: false }, actions: [{ type: 'connect' }] }

    case 'text': {
      if (state.phase !== 'open') return { state, actions: [] }
      const message = parseBridgeMessage(event.data)
      if (!message) return { state, actions: [] }
      // A status of our version that cannot be read: say so, send nothing until a readable one comes.
      if (message.kind === 'unreadable-status') return { state: { ...state, statusUnreadable: true }, actions: [] }
      if (message.kind === 'status') {
        // Only the first status after a connection runs steps 1 to 3; later ones never restore.
        if (!state.firstStatusSeen) return firstStatus(state, message.status)
        return { state: { ...state, status: message.status, statusUnreadable: false }, actions: [] }
      }
      // Step 5: show the code; an error answers the most recent frame, so forget refused snapshot bytes.
      const aboutSnapshot = state.lastFrame === 'snapshot' || state.lastFramePaired
      return {
        state: { ...state, error: message.code, lastSent: aboutSnapshot ? undefined : state.lastSent },
        actions: [],
      }
    }

    case 'solved': {
      // Nothing is built while the connection is off; a build that finishes late is stale.
      if (state.phase === 'off') return { state, actions: [] }
      const next = { ...state, plan: event.plan, buildError: undefined }
      if (!canSend(next)) return { state: next, actions: [] }
      // Step 4.
      return deliver(next, event.plan, next.autoSend)
    }

    case 'buildFailed':
      if (state.phase === 'off') return { state, actions: [] }
      return { state: { ...state, buildError: event.message }, actions: [] }

    case 'buildCleared':
      return { state: { ...state, buildError: undefined }, actions: [] }

    case 'sendFailed': {
      // The bytes did not leave: do not keep them as sent, and do not attribute an error to the frame.
      const forgetBytes = event.frame === 'snapshot' && state.lastSent?.id === event.id
      return {
        state: { ...state, lastSent: forgetBytes ? undefined : state.lastSent, lastFrame: undefined, lastFramePaired: false },
        actions: [],
      }
    }

    case 'send': {
      if (!canSend(state) || !state.plan) return { state, actions: [] }
      return deliver(state, state.plan, true)
    }
  }
}

// ---------------------------------------------------------------------------
// What to show
// ---------------------------------------------------------------------------

export type BadgeKind =
  | 'off'
  | 'connecting'
  | 'permission'
  | 'no-bridge'
  | 'blocked'
  | 'protocol-mismatch'
  | 'bad-status'
  | 'no-game'
  | 'game-quiet'
  | 'mod-mismatch'
  | 'data-set-mismatch'
  | 'connected'

export type BadgeTone = 'idle' | 'busy' | 'warn' | 'error' | 'ok'

export interface Badge {
  kind: BadgeKind
  tone: BadgeTone
  label: string
  /** A sentence or two for the popover. */
  detail: string
}

const BLOCK_HINT =
  'If the bridge is running, the browser or an extension may be blocking the connection: Chrome and Firefox ask for permission to connect to devices on your network, content blockers such as uBlock can block it, and Safari refuses a plain ws:// address from an https page.'

/** The delivery of the newest snapshot, in a few words (empty when the bridge holds none). */
export function transferText(status: BridgeStatus | undefined): string {
  const t = status?.transfer
  if (!t) return ''
  switch (t.state) {
    case 'waiting': return 'The bridge holds the plan and is waiting for the game.'
    case 'sending': return `Sending to the game${t.count ? ` (${t.sent ?? 0} of ${t.count} chunks)` : ''}.`
    case 'stalled': return 'Sending to the game is paused (the game is paused, saving or closed).'
    case 'delivered': return 'The game has the plan.'
    case 'rejected': return `The game refused the plan${t.reason ? ` (${t.reason})` : ''}.`
    case 'failed': return `The bridge gave up sending the plan${t.reason ? ` (${t.reason})` : ''}.`
    default: return ''
  }
}

export function badgeFor(state: ConnectionState): Badge {
  switch (state.phase) {
    case 'off':
      return { kind: 'off', tone: 'idle', label: 'Off', detail: 'The planner is not connected to the in-game viewer.' }
    case 'connecting':
      return state.slowConnect
        ? {
            kind: 'permission',
            tone: 'busy',
            label: 'Waiting for the browser',
            detail: 'The connection is taking a while. The browser may be asking for permission to connect to devices on your network: allow it, or the connection stays blocked.',
          }
        : { kind: 'connecting', tone: 'busy', label: 'Connecting', detail: 'Reaching the bridge.' }
    case 'waiting':
      if (state.failure === 'blocked') {
        return {
          kind: 'blocked',
          tone: 'error',
          label: 'Blocked by the browser',
          detail: 'The browser refused to open the connection (an https page may not open a plain ws:// address in every browser). Use the planner from http://localhost, or allow the connection. Retrying every few seconds.',
        }
      }
      if (state.failure === 'bad-address') {
        return { kind: 'blocked', tone: 'error', label: 'Bad address', detail: 'The bridge address is not a valid WebSocket address (it starts with ws://).' }
      }
      return {
        kind: 'no-bridge',
        tone: 'warn',
        label: 'No bridge',
        detail: `${state.failure === 'lost' ? 'The connection to the bridge closed.' : 'No bridge answered at this address.'} Start the bridge, or check the address. Retrying every few seconds. ${BLOCK_HINT}`,
      }
    case 'open': {
      const status = state.status
      if (state.statusUnreadable) {
        return {
          kind: 'bad-status',
          tone: 'error',
          label: 'Unreadable status',
          detail: `The bridge sent a status this planner could not read, although it speaks the same protocol version (${PROTOCOL_VERSION}). This is a bug in the bridge or the planner; please report it. Nothing is sent until a readable status arrives.`,
        }
      }
      if (!status) return { kind: 'connecting', tone: 'busy', label: 'Connecting', detail: 'Waiting for the bridge to report its state.' }
      if (state.protocolMismatch !== undefined) {
        return {
          kind: 'protocol-mismatch',
          tone: 'error',
          label: 'Version mismatch',
          detail: `The bridge speaks protocol ${state.protocolMismatch} and this planner speaks ${PROTOCOL_VERSION}. Update the planner and the bridge together; nothing is sent until then.`,
        }
      }
      const mod = status.mod
      const link = mod?.link ?? 'none'
      if (link === 'none') {
        return { kind: 'no-game', tone: 'warn', label: 'Bridge, no game', detail: 'The bridge is running but no game has answered it. Start Factorio with --enable-lua-udp and the mod enabled.' }
      }
      if (link === 'mismatch') {
        return { kind: 'mod-mismatch', tone: 'error', label: 'Mod version mismatch', detail: 'The mod and the bridge speak different protocol versions. Update the mod and the bridge together.' }
      }
      if (link === 'quiet') {
        return { kind: 'game-quiet', tone: 'warn', label: 'Game quiet', detail: `The bridge has not heard the game lately: it is paused, saving, at the title screen or closed. ${transferText(status)}`.trim() }
      }
      if ((mod?.unknownIds ?? 0) > 0) {
        return {
          kind: 'data-set-mismatch',
          tone: 'warn',
          label: 'Data set mismatch',
          detail: `The game does not know ${mod?.unknownIds} item, fluid, recipe or machine ids of the plan it holds. The planner's game data and the running game's mods differ. ${transferText(status)}`.trim(),
        }
      }
      return { kind: 'connected', tone: 'ok', label: 'Connected', detail: transferText(status) || 'The game is connected. Nothing has been sent yet.' }
    }
  }
}

/** The messages to show beside the badge: bridge errors, a plan that is too large, a build failure. */
export function notices(state: ConnectionState): string[] {
  const out: string[] = []
  if (state.error) out.push(describeBridgeError(state.error))
  // About the plan, so only while the connection is on: nothing is sent or built while it is off.
  if (state.phase === 'off') return out
  if (isTooLarge(state.plan)) {
    out.push(`This plan is too large for the in-game viewer (${(state.plan!.size / 1e6).toFixed(1)} MB, the limit is ${(MAX_SNAPSHOT_BYTES / 1e6).toFixed(0)} MB). It is not sent, and the game shows it as stale.`)
  }
  if (state.buildError) out.push(state.buildError)
  return out
}
