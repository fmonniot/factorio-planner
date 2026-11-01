import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WIRE } from '../test/datagramFixtures'
import { SnapshotSchema } from '../snapshot/schema'
import {
  DEFAULT_BRIDGE_URL,
  MAX_SNAPSHOT_BYTES,
  PLANNER_RETRY_MS,
  PROTOCOL_VERSION,
  WS_ENVELOPE_BYTES,
  describeBridgeError,
  encodeAnnounce,
  encodeSnapshotFrame,
  parseBridgeMessage,
  snapshotBytes,
  snapshotId,
} from './protocol'

interface Message {
  name: string
  frame?: 'text' | 'binary'
  from: string
  hex: string
  doc: string
  fields: Record<string, unknown>
}

const messages = (JSON.parse(readFileSync('contract/datagrams/messages.json', 'utf8')) as { messages: Message[] }).messages
const named = (name: string): Message => {
  const m = messages.find(x => x.name === name)
  if (!m) throw new Error(`no fixture ${name}`)
  return m
}
const fromHex = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'))

describe('constants', () => {
  it('equal the wire protocol constants table', () => {
    expect(PROTOCOL_VERSION).toBe(1)
    expect(MAX_SNAPSHOT_BYTES).toBe(WIRE.MAX_SNAPSHOT_BYTES)
    expect(WS_ENVELOPE_BYTES).toBe(WIRE.WS_ENVELOPE)
    expect(PLANNER_RETRY_MS).toBe(WIRE.PLANNER_RETRY * 1000)
    expect(DEFAULT_BRIDGE_URL).toBe('ws://127.0.0.1:34199/')
  })
})

describe('snapshot id and frame', () => {
  const small = readFileSync('contract/fixtures/small.json', 'utf8')
  const bytes = snapshotBytes(SnapshotSchema.parse(JSON.parse(small)))

  it('hashes the small fixture to the documented id', async () => {
    expect(await snapshotId(bytes)).toBe('b50eac1dfa0cae79')
  })

  it('writes the documented frame for the small fixture', async () => {
    const fixture = named('snapshot')
    expect(Buffer.from(encodeSnapshotFrame(await snapshotId(bytes), bytes)).toString('hex')).toBe(fixture.hex)
    expect(new TextDecoder().decode(encodeSnapshotFrame('b50eac1dfa0cae79', bytes).subarray(0, WS_ENVELOPE_BYTES))).toBe(fixture.doc)
  })

  it('writes the documented announce', () => {
    expect(encodeAnnounce('8a7dc7be68ce742c')).toBe(named('announce').doc)
  })
})

describe('messages from the bridge', () => {
  const statuses = messages.filter(m => m.from === 'bridge' && m.frame === 'text' && m.name.startsWith('status'))
  const errors = messages.filter(m => m.from === 'bridge' && m.frame === 'text' && m.name.startsWith('error'))

  it('has fixtures to replay', () => {
    expect(statuses.length).toBeGreaterThan(5)
    expect(errors).toHaveLength(4)
  })

  it.each(statuses.map(m => [m.name, m] as const))('reads %s', (_name, m) => {
    const parsed = parseBridgeMessage(new TextDecoder().decode(fromHex(m.hex)))
    expect(parsed?.kind).toBe('status')
    if (parsed?.kind === 'status') expect(parsed.status).toMatchObject({ protocol: m.fields.protocol, mod: m.fields.mod })
  })

  it.each(errors.map(m => [m.name, m] as const))('reads %s and describes it', (_name, m) => {
    const parsed = parseBridgeMessage(new TextDecoder().decode(fromHex(m.hex)))
    expect(parsed).toEqual({ kind: 'error', code: m.fields.code })
    expect(describeBridgeError(parsed && parsed.kind === 'error' ? parsed.code : '')).not.toMatch(/reported an error/)
  })

  it('drops what it cannot read', () => {
    expect(parseBridgeMessage('{')).toBeNull()
    expect(parseBridgeMessage('{"type":"status"}')).toBeNull()
    expect(parseBridgeMessage('{"type":"other"}')).toBeNull()
  })

  it('reports a status of our version that breaks the schema, instead of dropping it', () => {
    expect(parseBridgeMessage('{"type":"status","protocol":1,"mod":"oops"}')).toEqual({ kind: 'unreadable-status' })
    expect(parseBridgeMessage('{"type":"status","protocol":1,"newest":7}')).toEqual({ kind: 'unreadable-status' })
  })

  it('still accepts a malformed status of another version on its protocol alone', () => {
    expect(parseBridgeMessage('{"type":"status","protocol":2,"mod":"oops"}')).toEqual({ kind: 'status', status: { type: 'status', protocol: 2 } })
  })
})
