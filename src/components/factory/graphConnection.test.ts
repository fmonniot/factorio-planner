import { describe, it, expect } from 'vitest'
import { connectionStatus, edgeKey, edgeSummaryTitle, ordinal, pairStatus } from './graphConnection'
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

describe('edgeSummaryTitle', () => {
  it('says the count and the ends, then what is notable', () => {
    expect(edgeSummaryTitle(1, 'Miner', 'Consumer', ['ok'], false)).toBe('1 item from Miner to Consumer')
    expect(edgeSummaryTitle(3, 'Miner', 'Consumer', ['ok', 'limited', 'unused'], false)).toBe('3 items from Miner to Consumer; 1 limited; 1 not used')
    expect(edgeSummaryTitle(2, 'Miner', 'Consumer', ['ok', 'ok'], true)).toBe('2 items from Miner to Consumer; part of a loop')
    expect(edgeSummaryTitle(2, 'Miner', 'Consumer', ['ok', 'ok'], false, 1)).toBe('2 items from Miner to Consumer; 1 with a source rule in Consumer')
  })

  it('never says what a click does', () => {
    expect(edgeSummaryTitle(2, 'A', 'B', ['limited', 'ok'], true, 1)).not.toMatch(/click/i)
  })
})
