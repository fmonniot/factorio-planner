import { describe, it, expect } from 'vitest'
import { connectionStatus, edgeKey, ordinal, pairStatus } from './graphConnection'
import type { ConnectionFlow } from '../../data/types'

const flow = (status: ConnectionFlow['status']) => ({ status }) as ConnectionFlow

describe('graphConnection', () => {
  it('maps a flow to an edge status, pending until solved', () => {
    expect(connectionStatus(undefined)).toBe('pending')
    expect(connectionStatus(flow('ok'))).toBe('ok')
    expect(connectionStatus(flow('limited'))).toBe('limited')
    expect(connectionStatus(flow('missing-source'))).toBe('pending')
    expect(connectionStatus(flow('self'))).toBe('pending')
  })

  it('gives an edge the strongest status of its connections', () => {
    expect(pairStatus(['ok', 'limited', 'unused'])).toBe('limited')
    expect(pairStatus(['unused', 'ok'])).toBe('ok')
    expect(pairStatus(['unused'])).toBe('unused')
    expect(pairStatus(['pending'])).toBe('pending')
  })

  it('spells ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 112].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '112th'])
  })

  it('identifies an edge by its two blocks', () => {
    expect(edgeKey({ from: 'a', to: 'b' })).toBe('a>b')
  })
})
