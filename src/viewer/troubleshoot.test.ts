import { describe, expect, it } from 'vitest'
import { initialConnectionState, reduce, type ConnectionEvent } from './connection'
import { BRIDGE_COMMAND, troubleshootSteps } from './troubleshoot'

const status = (extra: object = {}, protocol = 1) =>
  JSON.stringify({ type: 'status', protocol, bridge: '0.1.0', mod: { link: 'none' }, ...extra })

function stateAfter(...events: ConnectionEvent[]) {
  return events.reduce(
    (state, e) => reduce(state, e).state,
    initialConnectionState(),
  )
}

const on = (...rest: ConnectionEvent[]) => stateAfter({ type: 'enable' }, ...rest)
const opened = (...rest: ConnectionEvent[]) => on({ type: 'opened' }, ...rest)
const tones = (state = initialConnectionState()) => troubleshootSteps(state).map(s => s.tone)

describe('troubleshootSteps', () => {
  it('always lists the bridge, the game and the plan, in that order', () => {
    expect(troubleshootSteps(initialConnectionState()).map(s => s.id)).toEqual(['bridge', 'game', 'plan'])
  })

  it('has nothing to say while the connection is off', () => {
    expect(tones()).toEqual(['idle', 'idle', 'idle'])
  })

  it('is on the bridge while it connects', () => {
    expect(tones(on())).toEqual(['busy', 'idle', 'idle'])
  })

  it('points at the bridge when none answers, with the command that starts it', () => {
    const [bridge, game, plan] = troubleshootSteps(on({ type: 'closed' }))
    expect(bridge).toMatchObject({ tone: 'warn', code: BRIDGE_COMMAND })
    expect([game.tone, plan.tone]).toEqual(['idle', 'idle'])
  })

  it('blames the bridge for a version mismatch, and nothing after it', () => {
    const steps = troubleshootSteps(opened({ type: 'text', data: status({}, 2) }))
    expect(steps[0]).toMatchObject({ tone: 'error', state: 'Version mismatch' })
    expect(steps[0].detail).toMatch(/protocol 2/)
    expect([steps[1].tone, steps[2].tone]).toEqual(['idle', 'idle'])
  })

  it('moves on to the game once the bridge runs, with the launch option', () => {
    const [bridge, game, plan] = troubleshootSteps(opened({ type: 'text', data: status() }))
    expect(bridge).toMatchObject({ tone: 'ok', state: 'Running' })
    expect(game).toMatchObject({ tone: 'warn', code: '--enable-lua-udp 34198' })
    expect(plan.tone).toBe('idle')
  })

  it('shows the port the bridge reports in the launch option', () => {
    const [, game] = troubleshootSteps(opened({ type: 'text', data: status({ gamePort: 40000 }) }))
    expect(game.code).toBe('--enable-lua-udp 40000')
  })

  it('does not name a launch option for a status it cannot read', () => {
    const [bridge, game] = troubleshootSteps(opened({ type: 'text', data: status({ mod: 'oops' }) }))
    expect(bridge.tone).toBe('error')
    expect(game.code).toBeUndefined()
  })

  it('blames the game for a quiet game and for a mod mismatch', () => {
    const quiet = opened({ type: 'text', data: status({ mod: { link: 'quiet', protocol: 1, stored: 'a'.repeat(16), unknownIds: 0 } }) })
    expect(tones(quiet)).toEqual(['ok', 'warn', 'idle'])
    const mismatch = opened({ type: 'text', data: status({ mod: { link: 'mismatch', protocol: 2 } }) })
    expect(tones(mismatch)).toEqual(['ok', 'error', 'idle'])
  })

  it('blames the plan when the game does not know its ids', () => {
    const steps = troubleshootSteps(opened({ type: 'text', data: status({ mod: { link: 'connected', protocol: 1, stored: 'a'.repeat(16), unknownIds: 3 } }) }))
    expect(steps.map(s => s.tone)).toEqual(['ok', 'ok', 'warn'])
    expect(steps[2].detail).toMatch(/3/)
  })

  it('is all green when connected', () => {
    expect(tones(opened({ type: 'text', data: status({ mod: { link: 'connected', protocol: 1, stored: 'a'.repeat(16), unknownIds: 0 } }) }))).toEqual(['ok', 'ok', 'ok'])
  })
})
