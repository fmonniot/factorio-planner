import { describe, expect, it } from 'vitest'
import {
  badgeFor,
  canSend,
  initialConnectionState,
  notices,
  reduce,
  type ConnectionAction,
  type ConnectionEvent,
  type ConnectionState,
  type PlanSnapshot,
} from './connection'
import { MAX_SNAPSHOT_BYTES } from './protocol'

// The six steps of "What the planner does" in the wire protocol, driven without a socket.

const bytes = (s: string) => new TextEncoder().encode(s)
const plan = (id: string, body = id): PlanSnapshot => ({ id, size: body.length, bytes: bytes(body) })
const A = plan('aaaaaaaaaaaaaaaa')
const B = plan('bbbbbbbbbbbbbbbb')

const status = (extra: object = {}, protocol = 1) =>
  JSON.stringify({ type: 'status', protocol, bridge: '0.1.0', mod: { link: 'none' }, ...extra })
const held = (id: string, extra: object = {}) =>
  status({ newest: id, transfer: { id, state: 'waiting', sent: 0, count: 1 }, ...extra })
const error = (code: string) => JSON.stringify({ type: 'error', code })

/** Runs events in order, returning the final state and every action performed. */
function run(events: ConnectionEvent[], from: ConnectionState = initialConnectionState()) {
  let state = from
  const actions: ConnectionAction[] = []
  for (const e of events) {
    const t = reduce(state, e)
    state = t.state
    actions.push(...t.actions)
  }
  return { state, actions }
}

const connect = (...rest: ConnectionEvent[]): ConnectionEvent[] => [{ type: 'enable' }, { type: 'opened' }, ...rest]
const text = (data: string): ConnectionEvent => ({ type: 'text', data })
const kinds = (actions: ConnectionAction[]) => actions.map(a => (a.type === 'announce' || a.type === 'sendSnapshot' ? `${a.type}:${a.id}` : a.type))

describe('switching on and off', () => {
  it('does nothing until enabled', () => {
    const { state, actions } = run([{ type: 'closed' }, { type: 'retry' }, text(status()), { type: 'solved', plan: A }])
    expect(state.phase).toBe('off')
    expect(actions).toEqual([])
  })

  it('connects when enabled and stops everything when disabled', () => {
    const on = run([{ type: 'enable' }])
    expect(kinds(on.actions)).toEqual(['connect'])
    const off = run([{ type: 'disable' }], on.state)
    expect(kinds(off.actions)).toEqual(['cancelRetry', 'disconnect'])
    expect(off.state.phase).toBe('off')
  })

  it('keeps the last sent bytes across off and on, but drops the plan, which goes stale', () => {
    const first = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' }, { type: 'disable' }))
    expect(first.state.lastSent?.id).toBe(A.id)
    expect(first.state.plan).toBeUndefined()
  })

  it('announces only the plan built after enabling, not the one from before it was switched off', () => {
    const off = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'disable' })).state
    // The first status arrives before the rebuild finishes.
    const { actions } = run([{ type: 'enable' }, { type: 'opened' }, text(status()), { type: 'solved', plan: B }], off)
    expect(kinds(actions)).toEqual(['connect', `announce:${B.id}`])
  })

  it('ignores a build that finishes after the connection was switched off', () => {
    const { state, actions } = run(connect(text(status()), { type: 'disable' }, { type: 'solved', plan: A }, { type: 'buildFailed', message: 'late' }))
    expect(state.plan).toBeUndefined()
    expect(state.buildError).toBeUndefined()
    expect(kinds(actions)).toEqual(['connect', 'cancelRetry', 'disconnect'])
  })
})

describe('step 1: the first status checks the protocol', () => {
  it('shows a mismatch, sends nothing and keeps the socket open', () => {
    const { state, actions } = run(connect({ type: 'solved', plan: A }, text(status({}, 2)), { type: 'send' }, { type: 'solved', plan: B }))
    expect(state.phase).toBe('open')
    expect(state.protocolMismatch).toBe(2)
    expect(kinds(actions)).toEqual(['connect'])
    expect(canSend(state)).toBe(false)
    expect(badgeFor(state).kind).toBe('protocol-mismatch')
  })

  it('accepts another version whose status has no other fields', () => {
    const { state } = run(connect(text(JSON.stringify({ type: 'status', protocol: 7, extra: 1 }))))
    expect(state.protocolMismatch).toBe(7)
  })

  it('sends nothing before the first status, even after a solve', () => {
    const { actions } = run(connect({ type: 'solved', plan: A }))
    expect(kinds(actions)).toEqual(['connect'])
  })
})

describe('step 2: restore only onto an empty bridge', () => {
  // A snapshot was sent in an earlier connection.
  const sentA = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' })).state
  const reconnect = (first: string, ...rest: ConnectionEvent[]) =>
    run([{ type: 'closed' }, { type: 'retry' }, { type: 'opened' }, text(first), ...rest], sentA)

  it('sends the same bytes again when the first status shows nothing held', () => {
    const { actions } = reconnect(status())
    expect(kinds(actions)).toEqual(['scheduleRetry', 'connect', `sendSnapshot:${A.id}`])
    const restore = actions.find(a => a.type === 'sendSnapshot')
    expect(restore && 'bytes' in restore && restore.bytes).toEqual(A.bytes)
  })

  it('sends nothing when the bridge holds a transfer', () => {
    expect(kinds(reconnect(held(B.id)).actions)).not.toContain(`sendSnapshot:${A.id}`)
  })

  it('sends nothing when the bridge only has a newest id', () => {
    expect(kinds(reconnect(status({ newest: B.id })).actions)).not.toContain(`sendSnapshot:${A.id}`)
  })

  it('never restores on a later status', () => {
    const { actions } = reconnect(held(B.id), text(status()))
    expect(kinds(actions)).not.toContain(`sendSnapshot:${A.id}`)
  })

  it('restores nothing when nothing was sent since the page loaded', () => {
    const { actions } = run(connect(text(status())))
    expect(kinds(actions)).toEqual(['connect'])
  })
})

describe('step 3: announce the current plan', () => {
  it('announces when nothing was sent yet', () => {
    const { actions } = run(connect({ type: 'solved', plan: A }, text(status())))
    expect(kinds(actions)).toEqual(['connect', `announce:${A.id}`])
  })

  it('announces nothing when the current plan is the bytes already sent', () => {
    const sent = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' })).state
    const { actions } = run([{ type: 'closed' }, { type: 'retry' }, { type: 'opened' }, text(held(A.id))], sent)
    expect(kinds(actions)).toEqual(['scheduleRetry', 'connect'])
  })

  it('announces the changed plan after a restore', () => {
    const sent = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' }, { type: 'solved', plan: B })).state
    const { actions } = run([{ type: 'closed' }, { type: 'retry' }, { type: 'opened' }, text(status())], sent)
    expect(kinds(actions).slice(-2)).toEqual([`sendSnapshot:${A.id}`, `announce:${B.id}`])
  })

  it('announces when another tab put a different plan on a bridge that was not restored', () => {
    // This tab sent A; another tab sent B to the bridge; on reconnect the bridge holds B.
    const sent = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' })).state
    const { actions } = run([{ type: 'closed' }, { type: 'retry' }, { type: 'opened' }, text(held(B.id))], sent)
    expect(kinds(actions)).toEqual(['scheduleRetry', 'connect', `announce:${A.id}`])
  })

  it('announces nothing when the bridge restored from here holds exactly the current plan', () => {
    const sent = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' })).state
    const { actions } = run([{ type: 'closed' }, { type: 'retry' }, { type: 'opened' }, text(status())], sent)
    expect(kinds(actions)).toEqual(['scheduleRetry', 'connect', `sendSnapshot:${A.id}`])
  })

  it('does nothing without a plan yet', () => {
    expect(kinds(run(connect(text(status()))).actions)).toEqual(['connect'])
  })
})

describe('step 4: after each solve', () => {
  it('announces when auto-send is off', () => {
    const { actions } = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'solved', plan: B }))
    expect(kinds(actions)).toEqual(['connect', `announce:${A.id}`, `announce:${B.id}`])
  })

  it('sends the snapshot when auto-send is on', () => {
    const { state, actions } = run([{ type: 'setAutoSend', value: true }, ...connect(text(status()), { type: 'solved', plan: A })])
    expect(kinds(actions)).toEqual(['connect', `sendSnapshot:${A.id}`])
    expect(state.lastSent?.id).toBe(A.id)
  })

  it('the Send action sends the bytes even when the bridge already holds that id', () => {
    const { actions } = run(connect(text(held(A.id, { mod: { link: 'connected', protocol: 1, stored: A.id, unknownIds: 0 } })), { type: 'solved', plan: A }, { type: 'send' }))
    expect(kinds(actions)).toContain(`sendSnapshot:${A.id}`)
  })

  it('Send does nothing before the first status or without a plan', () => {
    expect(kinds(run(connect({ type: 'solved', plan: A }, { type: 'send' })).actions)).toEqual(['connect'])
    expect(kinds(run(connect(text(status()), { type: 'send' })).actions)).toEqual(['connect'])
  })

  describe('the size check', () => {
    const huge: PlanSnapshot = { id: 'cccccccccccccccc', size: MAX_SNAPSHOT_BYTES + 1 }

    it('announces instead of sending, and says so, even with auto-send on', () => {
      const { state, actions } = run([{ type: 'setAutoSend', value: true }, ...connect(text(status()), { type: 'solved', plan: huge })])
      expect(kinds(actions)).toEqual(['connect', `announce:${huge.id}`])
      expect(state.lastSent).toBeUndefined()
      expect(notices(state).join()).toMatch(/too large/)
    })

    it('Send announces instead of sending', () => {
      const { actions } = run(connect(text(status()), { type: 'solved', plan: huge }, { type: 'send' }))
      expect(kinds(actions).filter(k => k.startsWith('sendSnapshot'))).toEqual([])
    })

    it('accepts a plan of exactly the limit', () => {
      const exact: PlanSnapshot = { id: 'dddddddddddddddd', size: MAX_SNAPSHOT_BYTES, bytes: new Uint8Array(1) }
      const { actions } = run([{ type: 'setAutoSend', value: true }, ...connect(text(status()), { type: 'solved', plan: exact })])
      expect(kinds(actions)).toContain(`sendSnapshot:${exact.id}`)
    })

    it('keeps the earlier bytes for a restore when a later plan is too large', () => {
      const { state } = run([{ type: 'setAutoSend', value: true }, ...connect(text(status()), { type: 'solved', plan: A }, { type: 'solved', plan: huge })])
      expect(state.lastSent?.id).toBe(A.id)
    })
  })
})

describe('step 5: errors', () => {
  it('shows the code in plain words and resends nothing', () => {
    const { state, actions } = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' }, text(error('too-large'))))
    expect(kinds(actions)).toEqual(['connect', `announce:${A.id}`, `sendSnapshot:${A.id}`])
    expect(state.error).toBe('too-large')
    expect(notices(state)[0]).toMatch(/too large/)
  })

  it('forgets the bytes of a refused snapshot, so a reconnect cannot restore them', () => {
    const refused = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' }, text(error('bad-envelope')))).state
    expect(refused.lastSent).toBeUndefined()
    const { actions } = run([{ type: 'closed' }, { type: 'retry' }, { type: 'opened' }, text(status())], refused)
    expect(kinds(actions).filter(k => k.startsWith('sendSnapshot'))).toEqual([])
  })

  it('keeps the earlier bytes when the refused frame was an announce', () => {
    const { state } = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' }, { type: 'solved', plan: B }, text(error('bad-message'))))
    expect(state.lastSent?.id).toBe(A.id)
  })

  it('forgets the bytes when a restore and its announce went out together', () => {
    const sent = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' }, { type: 'solved', plan: B })).state
    const { state } = run([{ type: 'closed' }, { type: 'retry' }, { type: 'opened' }, text(status()), text(error('protocol-mismatch'))], sent)
    expect(state.lastSent).toBeUndefined()
  })

  it('clears the error on the next Send', () => {
    const { state } = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' }, text(error('too-large')), { type: 'solved', plan: B }, { type: 'send' }))
    expect(state.error).toBeUndefined()
  })

  it('clears the error when the socket is lost, so no alert stays beside a No bridge badge', () => {
    const { state } = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' }, text(error('too-large')), { type: 'closed' }))
    expect(state.error).toBeUndefined()
    expect(badgeFor(state).kind).toBe('no-bridge')
    expect(notices(state)).toEqual([])
  })

  it('says something for a code it does not know', () => {
    const { state } = run(connect(text(status()), text(error('new-code'))))
    expect(notices(state)[0]).toMatch(/new-code/)
  })

  it('ignores text it cannot read', () => {
    const { state } = run(connect(text('not json'), text('{"type":"nope"}')))
    expect(state.firstStatusSeen).toBe(false)
  })
})

describe('a frame that could not be written', () => {
  it('forgets snapshot bytes that never left, so a restore does not rely on them', () => {
    const { state } = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' }, { type: 'sendFailed', frame: 'snapshot', id: A.id }))
    expect(state.lastSent).toBeUndefined()
    expect(state.lastFrame).toBeUndefined()
  })

  it('keeps the earlier bytes when only an announce failed, and attributes no error to it', () => {
    const { state } = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' }, { type: 'solved', plan: B }, { type: 'sendFailed', frame: 'announce', id: B.id }, text(error('bad-message'))))
    expect(state.lastSent?.id).toBe(A.id)
  })

  it('keeps the earlier bytes when a failed snapshot was a different one', () => {
    const { state } = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' }, { type: 'sendFailed', frame: 'snapshot', id: B.id }))
    expect(state.lastSent?.id).toBe(A.id)
  })
})

describe('step 6: retry', () => {
  it('schedules a retry when a socket closes and connects again when it fires', () => {
    const { state, actions } = run(connect(text(status()), { type: 'closed' }, { type: 'retry' }))
    expect(kinds(actions)).toEqual(['connect', 'scheduleRetry', 'connect'])
    expect(state.phase).toBe('connecting')
  })

  it('keeps retrying when the connection never opens', () => {
    const { actions } = run([{ type: 'enable' }, { type: 'closed' }, { type: 'retry' }, { type: 'closed' }, { type: 'retry' }])
    expect(kinds(actions)).toEqual(['connect', 'scheduleRetry', 'connect', 'scheduleRetry', 'connect'])
  })

  it('repeats step 1 on the new socket', () => {
    const { state } = run(connect(text(status({}, 2)), { type: 'closed' }, { type: 'retry' }, { type: 'opened' }))
    expect(state.protocolMismatch).toBeUndefined()
    expect(state.firstStatusSeen).toBe(false)
  })

  it('does not retry once switched off', () => {
    const { actions } = run([{ type: 'enable' }, { type: 'disable' }, { type: 'closed' }, { type: 'retry' }])
    expect(kinds(actions)).toEqual(['connect', 'cancelRetry', 'disconnect'])
  })

  it('a refused snapshot is never resent over a reconnect loop', () => {
    const events: ConnectionEvent[] = []
    for (let i = 0; i < 3; i++) events.push({ type: 'closed' }, { type: 'retry' }, { type: 'opened' }, text(status()))
    const { actions } = run(connect(text(status()), { type: 'solved', plan: A }, { type: 'send' }, text(error('bad-envelope')), ...events))
    expect(kinds(actions).filter(k => k.startsWith('sendSnapshot'))).toEqual([`sendSnapshot:${A.id}`])
  })
})

describe('a status that cannot be read', () => {
  const broken = JSON.stringify({ type: 'status', protocol: 1, mod: 'oops' })

  it('is shown as an error, not left as Connecting, and nothing is sent', () => {
    const { state, actions } = run(connect({ type: 'solved', plan: A }, text(broken), { type: 'send' }))
    expect(badgeFor(state).kind).toBe('bad-status')
    expect(badgeFor(state).tone).toBe('error')
    expect(canSend(state)).toBe(false)
    expect(kinds(actions)).toEqual(['connect'])
  })

  it('recovers with the next readable status, which runs the first-status steps', () => {
    const { state, actions } = run(connect({ type: 'solved', plan: A }, text(broken), text(status())))
    expect(badgeFor(state).kind).toBe('no-game')
    expect(kinds(actions)).toEqual(['connect', `announce:${A.id}`])
  })

  it('is reported too when it follows a readable status, and cleared by the next', () => {
    const bad = run(connect(text(status()), text(broken))).state
    expect(badgeFor(bad).kind).toBe('bad-status')
    expect(badgeFor(run([text(status())], bad).state).kind).toBe('no-game')
  })

  it('is forgotten with the socket', () => {
    const { state } = run(connect(text(broken), { type: 'closed' }, { type: 'retry' }, { type: 'opened' }))
    expect(state.statusUnreadable).toBe(false)
  })
})

describe('notices', () => {
  const huge: PlanSnapshot = { id: 'cccccccccccccccc', size: MAX_SNAPSHOT_BYTES + 1 }

  it('shows the too-large plan only while the connection is on', () => {
    const on = run(connect(text(status()), { type: 'solved', plan: huge })).state
    expect(notices(on).join()).toMatch(/too large/)
    const off = run([{ type: 'disable' }], on).state
    expect(notices(off)).toEqual([])
    // Even for a plan kept in the state by some other path.
    expect(notices({ ...on, phase: 'off' })).toEqual([])
  })

  it('shows a build failure while on, clears it with buildCleared, and drops it when switched off', () => {
    const failed = run(connect({ type: 'buildFailed', message: 'no crypto' })).state
    expect(notices(failed)).toEqual(['no crypto'])
    expect(notices(run([{ type: 'buildCleared' }], failed).state)).toEqual([])
    expect(notices(run([{ type: 'disable' }], failed).state)).toEqual([])
  })
})

describe('connection failures', () => {
  it('reports a browser that refuses to create the socket, and retries', () => {
    const { state, actions } = run([{ type: 'enable' }, { type: 'connectThrew', reason: 'blocked' }])
    expect(badgeFor(state).kind).toBe('blocked')
    expect(kinds(actions)).toEqual(['connect', 'scheduleRetry'])
  })

  it('reports a bad address', () => {
    const { state } = run([{ type: 'enable' }, { type: 'connectThrew', reason: 'bad-address' }])
    expect(badgeFor(state).label).toBe('Bad address')
  })

  it('names a socket that closes without opening, and mentions the browser', () => {
    const { state } = run([{ type: 'enable' }, { type: 'closed' }])
    const badge = badgeFor(state)
    expect(badge.kind).toBe('no-bridge')
    expect(badge.detail).toMatch(/uBlock/)
    expect(badge.detail).toMatch(/permission/)
  })

  it('suggests the permission prompt when connecting takes long', () => {
    const { state } = run([{ type: 'enable' }, { type: 'slow' }])
    expect(badgeFor(state).kind).toBe('permission')
  })
})

describe('the badge', () => {
  const badge = (first: object) => badgeFor(run(connect(text(status(first)))).state)

  it('is off by default', () => {
    expect(badgeFor(initialConnectionState()).kind).toBe('off')
  })

  it('tells a bridge without a game, a quiet game, a mod mismatch, a connected game', () => {
    expect(badge({ mod: { link: 'none' } }).kind).toBe('no-game')
    expect(badge({ mod: { link: 'quiet', protocol: 1, stored: A.id, unknownIds: 0 } }).kind).toBe('game-quiet')
    expect(badge({ mod: { link: 'mismatch', protocol: 2 } }).kind).toBe('mod-mismatch')
    expect(badge({ mod: { link: 'connected', protocol: 1 } }).kind).toBe('connected')
  })

  it('shows the data-set mismatch when the mod reports unknown ids', () => {
    const b = badge({ mod: { link: 'connected', protocol: 1, stored: A.id, unknownIds: 3 } })
    expect(b.kind).toBe('data-set-mismatch')
    expect(b.detail).toMatch(/3/)
  })

  it('follows later statuses', () => {
    const { state } = run(connect(text(status()), text(held(A.id, { mod: { link: 'connected', protocol: 1, stored: A.id, unknownIds: 0 }, transfer: { id: A.id, state: 'delivered', sent: 1, count: 1 } }))))
    expect(badgeFor(state).kind).toBe('connected')
    expect(badgeFor(state).detail).toMatch(/game has the plan/)
  })

  it('reports a refused transfer', () => {
    const { state } = run(connect(text(held(A.id, { mod: { link: 'connected', protocol: 1 }, transfer: { id: A.id, state: 'rejected', sent: 1, count: 1, reason: 'json' } }))))
    expect(badgeFor(state).detail).toMatch(/refused.*json/)
  })
})
